using System.IO;
using System.Text;
using System.Text.Json;
namespace CartridgeControl;
public sealed class Database : IDisposable
{
    public string Root { get; }
    public string FilePath => Path.Combine(Root, "database.json");
    private readonly FileStream _lock;
    private readonly SemaphoreSlim _gate = new(1, 1);
    public Database(string root)
    {
        Root = Path.GetFullPath(root);
        Directory.CreateDirectory(Root);
        foreach (var folder in new[] { "Backups", "Config", "Logs" }) Directory.CreateDirectory(Path.Combine(Root, folder));
        try { _lock = new FileStream(Path.Combine(Root, "database.lock"), FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None); }
        catch (IOException) { throw new IOException("База уже открыта другой копией программы. Закройте её и повторите запуск."); }
    }
    public async Task<object> LoadAsync()
    {
        await _gate.WaitAsync();
        try
        {
            if (!File.Exists(FilePath)) return new { success = true, data = (object?)null, path = FilePath };
            var raw = await File.ReadAllTextAsync(FilePath, Encoding.UTF8);
            var data = JsonSerializer.Deserialize<JsonElement>(raw);
            if (data.ValueKind != JsonValueKind.Object) throw new InvalidDataException("Некорректный корневой объект базы.");
            var initial = Path.Combine(Root, "Backups", "before-first-native.json");
            if (!File.Exists(initial)) await WriteNewAsync(initial, raw);
            return new { success = true, data, path = FilePath };
        }
        catch (Exception error) { return new { success = false, error = error.Message, path = FilePath }; }
        finally { _gate.Release(); }
    }
    public async Task<object> SaveAsync(JsonElement data, JsonElement backup)
    {
        await _gate.WaitAsync();
        try
        {
            if (data.ValueKind != JsonValueKind.Object || !data.TryGetProperty("printers", out var printers) || printers.ValueKind != JsonValueKind.Array)
                throw new InvalidDataException("Некорректный формат базы для сохранения.");
            string? backupPath = null;
            if (backup.ValueKind == JsonValueKind.Object)
            {
                backupPath = Path.Combine(Root, "Backups", $"before-reference-{DateTime.Now:yyyyMMdd-HHmmss}-{Guid.NewGuid():N}.json");
                await WriteNewAsync(backupPath, backup.GetRawText());
            }
            await AtomicWriteAsync(FilePath, data.GetRawText());
            // Settings are a mirror; the complete database above is the source of truth.
            if (data.TryGetProperty("settings", out var settings))
            {
                try { await AtomicWriteAsync(Path.Combine(Root, "Config", "settings.json"), settings.GetRawText()); }
                catch (Exception error) { try { await File.AppendAllTextAsync(Path.Combine(Root, "Logs", "settings.log"), error.Message + Environment.NewLine); } catch { } }
            }
            return new { success = true, path = FilePath, backupPath };
        }
        catch (Exception error) { return new { success = false, error = error.Message, path = FilePath }; }
        finally { _gate.Release(); }
    }
    private static async Task WriteNewAsync(string path, string text)
    {
        await using var stream = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None, 65536, FileOptions.Asynchronous | FileOptions.WriteThrough);
        await stream.WriteAsync(Encoding.UTF8.GetBytes(text));
        await stream.FlushAsync();
    }
    private static async Task AtomicWriteAsync(string path, string text)
    {
        var temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            await WriteNewAsync(temporary, text);
            if (File.Exists(path)) File.Replace(temporary, path, null); else File.Move(temporary, path);
        }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }
    public void Dispose() { _lock.Dispose(); _gate.Dispose(); }
}
