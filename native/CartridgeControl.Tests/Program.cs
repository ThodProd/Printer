using System.IO;
using System.Text;
using System.Text.Json;
using CartridgeControl;
static void Check(bool condition, string message) { if (!condition) throw new Exception(message); }
static JsonElement Json(string text) => JsonSerializer.Deserialize<JsonElement>(text);
static JsonElement Result(object value) => JsonSerializer.SerializeToElement(value);
var root = Path.Combine(Path.GetTempPath(), "cartridge-native-unit-" + Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(root);
var original = "{\"version\":1,\"printers\":[{\"programId\":\"P-KEEP\",\"inventoryNumber\":\"001\",\"boss\":\"Иванов\"}],\"cartridges\":[{\"id\":\"C-KEEP\",\"history\":[{\"id\":\"H-KEEP\"}]}]}";
var next = original.Replace("Иванов", "Пупкин");
await File.WriteAllTextAsync(Path.Combine(root, "database.json"), original);
using (var db = new Database(root))
{
    Check(Result(await db.LoadAsync()).GetProperty("success").GetBoolean(), "load failed");
    Check(await File.ReadAllTextAsync(Path.Combine(root, "Backups", "before-first-native.json")) == original, "first-native backup must be exact original JSON");
    var result = Result(await db.SaveAsync(Json(next), Json(original)));
    Check(result.GetProperty("success").GetBoolean(), "save failed");
    Check(await File.ReadAllTextAsync(db.FilePath) == next, "save did not persist complete data");
    Check(await File.ReadAllTextAsync(result.GetProperty("backupPath").GetString()!) == original, "backup mismatch");
    Check(!Result(await db.SaveAsync(Json("{}"), default)).GetProperty("success").GetBoolean(), "invalid data accepted");
    Check(await File.ReadAllTextAsync(db.FilePath) == next, "failed save changed file");
    using (var locked = new FileStream(db.FilePath, FileMode.Open, FileAccess.Read, FileShare.Read))
        Check(!Result(await db.SaveAsync(Json(original), default)).GetProperty("success").GetBoolean(), "locked database should reject replacement");
    Check(await File.ReadAllTextAsync(db.FilePath) == next, "locked save changed file");
    var rejected = false;
    try { using var second = new Database(root); } catch (IOException) { rejected = true; }
    Check(rejected, "second app should not acquire the same database");
}
Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
var label = Encoding.GetEncoding(1251).GetString(NativePrinter.EncodeLabel("TEXT 0,0,\"2\",0,1,1,\"Иванов Ё\"\r\nPRINT 1,1"));
Check(label.StartsWith("CLS\r\nCODEPAGE 1251\r\n"), "TSPL preamble mismatch");
Check(label.Contains("Иванов Ё"), "Cyrillic TSPL encoding mismatch");
var existing = "CLS\r\nCODEPAGE 1251\r\nPRINT 1,1";
Check(Encoding.GetEncoding(1251).GetString(NativePrinter.EncodeLabel(existing)) == existing, "existing TSPL preamble changed");
Console.WriteLine("PASS: exact legacy backup, atomic disk save, IDs/history, failed saves, database lock and TSPL encoding. " + root);
