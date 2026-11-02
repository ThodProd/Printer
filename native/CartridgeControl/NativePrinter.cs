using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Printing;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
namespace CartridgeControl;
public static class NativePrinter
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct DocumentInfo
    {
        [MarshalAs(UnmanagedType.LPWStr)] public string Name;
        [MarshalAs(UnmanagedType.LPWStr)] public string? Output;
        [MarshalAs(UnmanagedType.LPWStr)] public string Type;
    }
    [DllImport("winspool.drv", EntryPoint = "OpenPrinterW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool OpenPrinter(string name, out IntPtr printer, IntPtr defaults);
    [DllImport("winspool.drv", SetLastError = true)] private static extern bool ClosePrinter(IntPtr printer);
    [DllImport("winspool.drv", EntryPoint = "StartDocPrinterW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern int StartDocPrinter(IntPtr printer, int level, ref DocumentInfo info);
    [DllImport("winspool.drv", SetLastError = true)] private static extern bool StartPagePrinter(IntPtr printer);
    [DllImport("winspool.drv", SetLastError = true)] private static extern bool WritePrinter(IntPtr printer, byte[] bytes, int count, out int written);
    [DllImport("winspool.drv", SetLastError = true)] private static extern bool EndPagePrinter(IntPtr printer);
    [DllImport("winspool.drv", SetLastError = true)] private static extern bool EndDocPrinter(IntPtr printer);
    [DllImport("winspool.drv", SetLastError = true)] private static extern bool AbortPrinter(IntPtr printer);
    public static string[] GetPrinters()
    {
        using var server = new LocalPrintServer();
        using var queues = server.GetPrintQueues(new[] { EnumeratedPrintQueueTypes.Local, EnumeratedPrintQueueTypes.Connections });
        return queues.Select(p => p.FullName).Distinct().OrderBy(p => p).ToArray();
    }
    public static object Ping(string name)
    {
        if (!OpenPrinter(name, out var printer, IntPtr.Zero)) return new { ok = false, message = new Win32Exception().Message };
        ClosePrinter(printer);
        return new { ok = true, message = "Принтер доступен" };
    }
    public static byte[] EncodeLabel(string data)
    {
        data = data.TrimStart('\uFEFF');
        if (!Regex.IsMatch(data, @"^\s*CLS\s*(\r?\n|$)", RegexOptions.IgnoreCase)) data = "CLS\r\n" + data;
        if (!Regex.IsMatch(data, @"^\s*CODEPAGE\s+1251\b", RegexOptions.Multiline | RegexOptions.IgnoreCase))
            data = Regex.Replace(data, @"^(\s*CLS\s*(?:\r?\n)?)", "$1CODEPAGE 1251\r\n", RegexOptions.IgnoreCase);
        Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
        return Encoding.GetEncoding(1251).GetBytes(data);
    }
    public static async Task<object> PrintAsync(string name, string data, string mode)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(name)) throw new InvalidOperationException("Принтер не выбран.");
            var bytes = EncodeLabel(data);
            if (mode == "driver")
            {
                var temporary = Path.Combine(Path.GetTempPath(), "cartridge-label-" + Guid.NewGuid().ToString("N") + ".prn");
                try
                {
                    await File.WriteAllBytesAsync(temporary, bytes);
                    await RunAsync(Path.Combine(Environment.SystemDirectory, "print.exe"), ["/D:" + name, temporary], TimeSpan.FromSeconds(30));
                }
                finally { if (File.Exists(temporary)) File.Delete(temporary); }
            }
            else if (mode == "raw") await Task.Run(() => PrintRaw(name, bytes));
            else throw new InvalidOperationException("Неизвестный режим печати.");
            return new { success = true };
        }
        catch (Exception error) { return new { success = false, error = error.Message }; }
    }
    private static void PrintRaw(string name, byte[] bytes)
    {
        if (!OpenPrinter(name, out var printer, IntPtr.Zero)) throw new Win32Exception();
        var started = false;
        try
        {
            var info = new DocumentInfo { Name = "TSPL Print Job", Type = "RAW" };
            if (StartDocPrinter(printer, 1, ref info) <= 0) throw new Win32Exception();
            started = true;
            if (!StartPagePrinter(printer)) throw new Win32Exception();
            if (!WritePrinter(printer, bytes, bytes.Length, out var written)) throw new Win32Exception();
            if (written != bytes.Length) throw new IOException("Принтер принял только часть задания.");
            if (!EndPagePrinter(printer)) throw new Win32Exception();
            if (!EndDocPrinter(printer)) throw new Win32Exception();
            started = false;
        }
        finally { if (started) AbortPrinter(printer); ClosePrinter(printer); }
    }
    private static async Task RunAsync(string executable, string[] arguments, TimeSpan timeout)
    {
        var info = new ProcessStartInfo(executable) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true };
        foreach (var arg in arguments) info.ArgumentList.Add(arg);
        using var process = Process.Start(info) ?? throw new IOException("Не удалось запустить " + executable);
        var stdout = process.StandardOutput.ReadToEndAsync(); var stderr = process.StandardError.ReadToEndAsync();
        using var cancellation = new CancellationTokenSource(timeout);
        try { await process.WaitForExitAsync(cancellation.Token); }
        catch (OperationCanceledException) { process.Kill(true); throw new TimeoutException("Превышено время ожидания Windows."); }
        if (process.ExitCode != 0) throw new IOException((await stderr) + (await stdout));
    }
    public static async Task<object> InstallDriverAsync(string dataRoot)
    {
        var temporary = Path.Combine(Path.GetTempPath(), "cartridge-driver-" + Guid.NewGuid().ToString("N"));
        try
        {
            var cab = Path.Combine(AppContext.BaseDirectory, "drivers", "TSC_driver.cab");
            if (!File.Exists(cab)) throw new FileNotFoundException("В комплекте программы не найден драйвер TSC.", cab);
            Directory.CreateDirectory(temporary);
            await RunAsync(Path.Combine(Environment.SystemDirectory, "expand.exe"), ["-F:*", cab, temporary], TimeSpan.FromMinutes(1));
            var inf = Directory.GetFiles(temporary, "*.inf", SearchOption.AllDirectories).FirstOrDefault() ?? throw new IOException("В архиве драйвера нет INF.");
            var info = new ProcessStartInfo(Path.Combine(Environment.SystemDirectory, "pnputil.exe")) { UseShellExecute = true, Verb = "runas", WindowStyle = ProcessWindowStyle.Hidden };
            info.ArgumentList.Add("/add-driver"); info.ArgumentList.Add(inf); info.ArgumentList.Add("/install");
            using var process = Process.Start(info) ?? throw new IOException("Установка драйвера не запущена.");
            await process.WaitForExitAsync();
            await File.AppendAllTextAsync(Path.Combine(dataRoot, "Logs", "install-driver.log"), $"{DateTime.Now:O}: exit={process.ExitCode}{Environment.NewLine}");
            if (process.ExitCode != 0 && process.ExitCode != 3010) throw new IOException("Установка драйвера завершилась с кодом " + process.ExitCode);
            return new { success = true };
        }
        catch (Exception error) { return new { success = false, error = error.Message }; }
        finally
        {
            // This path is created above from a fixed temp prefix and a fresh GUID.
            if (Directory.Exists(temporary)) { try { Directory.Delete(temporary, true); } catch { } }
        }
    }
}
