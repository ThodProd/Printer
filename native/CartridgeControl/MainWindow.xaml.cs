using System.Diagnostics;
using System.IO;
using System.Text.Json;
using System.Windows;
using System.Windows.Input;
using Microsoft.Web.WebView2.Core;
using Microsoft.Win32;
namespace CartridgeControl;
public partial class MainWindow : Window
{
    private const double DefaultZoom = 0.9;
    private const string Host = "cartridgecontrol.local";
    private const string Origin = "https://" + Host;
    private Database? _database;
    private bool _allowClose, _requestPending, _reload, _ready, _fullscreen;
    private WindowState _previousState;
    public MainWindow()
    {
        InitializeComponent();
        Loaded += async (_, _) => await InitializeAsync();
        Activated += (_, _) => { if (Browser.CoreWebView2 is not null) Browser.Focus(); };
        Closing += (_, e) =>
        {
            if (_allowClose || !_ready) return;
            e.Cancel = true; RequestFlush(false);
        };
        Closed += (_, _) => { Browser.Dispose(); _database?.Dispose(); };
        PreviewKeyDown += (_, e) =>
        {
            if (e.Key == Key.F11) { e.Handled = true; ToggleFullscreen(); }
            else if (e.Key == Key.F12) { e.Handled = true; Browser.CoreWebView2?.OpenDevToolsWindow(); }
            else if (e.Key == Key.F5 || e.Key == Key.R && Keyboard.Modifiers == ModifierKeys.Control) { e.Handled = true; RequestFlush(true); }
            else if (e.Key == Key.Escape && _fullscreen) { e.Handled = true; ToggleFullscreen(); }
        };
    }
    private async Task InitializeAsync()
    {
        try
        {
            var dataPath = Environment.GetEnvironmentVariable("CARTRIDGE_DATA_DIR") ?? Path.Combine(AppContext.BaseDirectory, "Data");
            _database = new Database(dataPath);
            var profile = Environment.GetEnvironmentVariable("CARTRIDGE_WEBVIEW_DIR") ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "CartridgeControl", "WebView2");
            var environment = await CoreWebView2Environment.CreateAsync(null, profile);
            await Browser.EnsureCoreWebView2Async(environment);
            Browser.ZoomFactor = DefaultZoom;
            var core = Browser.CoreWebView2;
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.IsPasswordAutosaveEnabled = false;
            core.Settings.IsGeneralAutofillEnabled = false;
            core.SetVirtualHostNameToFolderMapping(Host, Path.Combine(AppContext.BaseDirectory, "wwwroot"), CoreWebView2HostResourceAccessKind.DenyCors);
            core.NavigationStarting += (_, e) => { if (!e.Uri.StartsWith(Origin + "/", StringComparison.Ordinal)) e.Cancel = true; };
            core.NewWindowRequested += (_, e) => e.Handled = true;
            core.PermissionRequested += (_, e) => e.State = CoreWebView2PermissionState.Deny;
            core.WebMessageReceived += OnMessage;
            core.NavigationCompleted += (_, e) => { if (e.IsSuccess) { Browser.ZoomFactor = DefaultZoom; Browser.Focus(); } };
            core.Navigate(Origin + "/index.html");
        }
        catch (Exception error)
        {
            Browser.Visibility = Visibility.Collapsed; StartupHelp.Visibility = Visibility.Visible; StartupError.Text = error.Message;
        }
    }
    private async void OnMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        if (!e.Source.StartsWith(Origin + "/", StringComparison.Ordinal)) return;
        string? id = null;
        try
        {
            var message = JsonSerializer.Deserialize<JsonElement>(e.WebMessageAsJson);
            id = message.GetProperty("id").GetString();
            var result = await HandleAsync(message.GetProperty("method").GetString()!, message.GetProperty("args"));
            if (!_allowClose) Browser.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new { id, result }));
        }
        catch (Exception error)
        {
            if (!_allowClose) Browser.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new { id, error = error.Message }));
        }
    }
    private async Task<object?> HandleAsync(string method, JsonElement args)
    {
        var database = _database ?? throw new InvalidOperationException("База недоступна.");
        switch (method)
        {
            case "frontend-ready": _ready = true; return true;
            case "load-database": return await database.LoadAsync();
            case "save-database": return await database.SaveAsync(args[0], args.GetArrayLength() > 1 ? args[1] : default);
            case "get-data-folder": return database.Root;
            case "get-version": return "1.1.18";
            case "get-printers": return await Task.Run(NativePrinter.GetPrinters);
            case "ping-printer": return await Task.Run(() => NativePrinter.Ping(args[0].GetString()!));
            case "raw-print": return await NativePrinter.PrintAsync(args[0].GetString()!, args[1].GetString()!, args.GetArrayLength() > 2 ? args[2].GetString() ?? "raw" : "raw");
            case "install-driver": return await NativePrinter.InstallDriverAsync(database.Root);
            case "open-folder":
                var folder = Path.GetFullPath(args[0].GetString()!);
                if (!Directory.Exists(folder)) return false;
                Process.Start(new ProcessStartInfo(folder) { UseShellExecute = true }); return true;
            case "show-save-dialog":
                var options = args[0];
                var dialog = new SaveFileDialog();
                if (options.TryGetProperty("title", out var title)) dialog.Title = title.GetString();
                if (options.TryGetProperty("defaultPath", out var file)) dialog.FileName = file.GetString();
                if (options.TryGetProperty("filters", out var filters))
                    dialog.Filter = string.Join("|", filters.EnumerateArray().Select(f => f.GetProperty("name").GetString() + "|" + string.Join(";", f.GetProperty("extensions").EnumerateArray().Select(x => "*." + x.GetString()))));
                try { var accepted = dialog.ShowDialog(this) == true; return new { canceled = !accepted, filePath = accepted ? dialog.FileName : null }; }
                finally { Activate(); Browser.Focus(); }
            case "finish-close":
                if (!_requestPending) return true;
                _requestPending = false;
                if (!args[0].GetBoolean()) return false;
                if (_reload) { _ready = false; Browser.CoreWebView2.Reload(); }
                else { _allowClose = true; _ = Dispatcher.BeginInvoke(new Action(Close)); }
                return true;
            default: throw new InvalidOperationException("Неизвестная команда: " + method);
        }
    }
    private async void RequestFlush(bool reload)
    {
        if (_requestPending) return;
        if (!_ready) { if (reload) Browser.CoreWebView2?.Reload(); else { _allowClose = true; Close(); } return; }
        _requestPending = true; _reload = reload;
        try { await Browser.CoreWebView2.ExecuteScriptAsync("window.dispatchEvent(new Event('app-before-close'))"); }
        catch { _requestPending = false; }
    }
    private void Reload_Click(object sender, RoutedEventArgs e) => RequestFlush(true);
    private void Exit_Click(object sender, RoutedEventArgs e) => Close();
    private void ZoomOut_Click(object sender, RoutedEventArgs e) => Browser.ZoomFactor = Math.Max(.5, Browser.ZoomFactor - .1);
    private void ZoomIn_Click(object sender, RoutedEventArgs e) => Browser.ZoomFactor = Math.Min(3, Browser.ZoomFactor + .1);
    private void ZoomReset_Click(object sender, RoutedEventArgs e) => Browser.ZoomFactor = DefaultZoom;
    private void DevTools_Click(object sender, RoutedEventArgs e) => Browser.CoreWebView2?.OpenDevToolsWindow();
    private void Fullscreen_Click(object sender, RoutedEventArgs e) => ToggleFullscreen();
    private void ToggleFullscreen()
    {
        if (!_fullscreen) { _previousState = WindowState; WindowStyle = WindowStyle.None; WindowState = WindowState.Maximized; }
        else { WindowStyle = WindowStyle.SingleBorderWindow; WindowState = _previousState; }
        _fullscreen = !_fullscreen;
    }
    private async void Edit_Click(object sender, RoutedEventArgs e)
    {
        if (sender is not System.Windows.Controls.MenuItem item || Browser.CoreWebView2 is null) return;
        Browser.Focus();
        var command = item.Tag?.ToString();
        try
        {
            // WPF menu clicks are not browser clipboard gestures. Use the Windows
            // clipboard explicitly while leaving native keyboard shortcuts intact.
            if (command == "paste")
            {
                if (Clipboard.ContainsText()) await Browser.CoreWebView2.ExecuteScriptAsync("document.execCommand('insertText',false," + JsonSerializer.Serialize(Clipboard.GetText()) + ")");
            }
            else if (command is "copy" or "cut")
            {
                var json = await Browser.CoreWebView2.ExecuteScriptAsync("(()=>{const e=document.activeElement;return e && typeof e.selectionStart==='number' ? e.value.slice(e.selectionStart,e.selectionEnd) : String(window.getSelection()||'')})()");
                var text = JsonSerializer.Deserialize<string>(json);
                if (!string.IsNullOrEmpty(text))
                {
                    Clipboard.SetText(text);
                    if (command == "cut") await Browser.CoreWebView2.ExecuteScriptAsync("document.execCommand('delete')");
                }
            }
            else await Browser.CoreWebView2.ExecuteScriptAsync("document.execCommand(" + JsonSerializer.Serialize(command) + ")");
        }
        catch (System.Runtime.InteropServices.COMException) { Browser.Focus(); }
    }
    private async void About_Click(object sender, RoutedEventArgs e)
    {
        if (Browser.CoreWebView2 is not null) await Browser.CoreWebView2.ExecuteScriptAsync("document.querySelector('[title=\"О программе\"]')?.click()");
    }
    private void WebViewDownload_Click(object sender, RoutedEventArgs e) => Process.Start(new ProcessStartInfo("https://developer.microsoft.com/microsoft-edge/webview2/#download-section") { UseShellExecute = true });
}
