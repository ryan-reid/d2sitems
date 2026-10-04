using D2SItems;
using System.Diagnostics;

if (args.Length == 2 && args[0] == "crash")
{
    SaveFileTransaction.JournalDirectory = Path.Combine(args[1], "journal");
    SaveFileTransaction.AfterReplace = _ => Environment.Exit(73);
    SaveFileTransaction.Commit(
        new(Path.Combine(args[1], "source.d2s"), [1, 2, 3], [4, 5, 6]),
        new(Path.Combine(args[1], "target.d2s"), [1, 2, 3], [4, 5, 6]));
    return;
}
var directory = Path.Combine(Path.GetTempPath(), "d2sitems-safety-" + Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(directory);
SaveFileTransaction.JournalDirectory = Path.Combine(directory, "journal");
var source = Path.Combine(directory, "source.d2s");
var target = Path.Combine(directory, "target.d2s");
byte[] original = [1, 2, 3], changed = [4, 5, 6];
void Check(bool condition, string name)
{
    if (!condition) throw new Exception(name);
    Console.WriteLine("PASS " + name);
}
void Reset() { File.WriteAllBytes(source, original); File.WriteAllBytes(target, original); }
void ExpectFailure(Action action)
{
    try { action(); } catch (IOException) { return; }
    throw new Exception("Expected an I/O failure");
}
Reset();
var first = SaveBackup.CreateBackup(source)!;
File.WriteAllBytes(source, changed);
var second = SaveBackup.CreateBackup(source)!;
Check(first != second && File.ReadAllBytes(first).SequenceEqual(original)
    && File.ReadAllBytes(second).SequenceEqual(changed), "rapid backups preserve both revisions");
Reset();
var backups = SaveFileTransaction.Commit(new(source, original, changed), new(target, original, changed));
Check(File.ReadAllBytes(source).SequenceEqual(changed) && File.ReadAllBytes(target).SequenceEqual(changed)
    && backups.All(p => File.ReadAllBytes(p).SequenceEqual(original)), "paired commit preserves originals in backups");
Reset();
File.SetAttributes(target, FileAttributes.ReadOnly);
try { ExpectFailure(() => SaveFileTransaction.Commit(new(source, original, changed), new(target, original, changed))); }
finally { File.SetAttributes(target, FileAttributes.Normal); }
Check(File.ReadAllBytes(source).SequenceEqual(original) && File.ReadAllBytes(target).SequenceEqual(original), "read-only destination leaves both originals intact");
Reset();
if (OperatingSystem.IsWindows())
{
    using (var locked = new FileStream(target, FileMode.Open, FileAccess.Read, FileShare.Read))
        ExpectFailure(() => SaveFileTransaction.Commit(new(source, original, changed), new(target, original, changed)));
    Check(File.ReadAllBytes(source).SequenceEqual(original) && File.ReadAllBytes(target).SequenceEqual(original), "second replacement failure rolls back first replacement");
}
Reset();
File.WriteAllBytes(target, changed);
ExpectFailure(() => SaveFileTransaction.Commit(new(source, original, changed), new(target, original, changed)));
Check(File.ReadAllBytes(source).SequenceEqual(original) && File.ReadAllBytes(target).SequenceEqual(changed), "stale snapshot rejected without overwriting newer bytes");
Reset();
SaveFileTransaction.Commit(new SaveFileTransaction.Update(source, original, changed));
Check(File.ReadAllBytes(source).SequenceEqual(changed), "single-file commit succeeds");
Check(!Directory.EnumerateFiles(directory, "*.pending").Any(), "staging files cleaned after success and failure");
Console.WriteLine("Disposable test files retained at " + directory);

Reset();
var childInfo = new ProcessStartInfo(Environment.ProcessPath!) { UseShellExecute = false };
childInfo.ArgumentList.Add("crash");
childInfo.ArgumentList.Add(directory);
using (var child = Process.Start(childInfo)!) { child.WaitForExit(); Check(child.ExitCode == 73, "child terminated between replacements"); }
Check(File.ReadAllBytes(source).SequenceEqual(changed) && File.ReadAllBytes(target).SequenceEqual(original), "interrupted state reproduced");
SaveFileTransaction.RecoverPending();
Check(File.ReadAllBytes(source).SequenceEqual(original) && File.ReadAllBytes(target).SequenceEqual(original), "restart recovery restores both originals");
SaveFileTransaction.RecoverPending();
Check(!Directory.EnumerateFiles(SaveFileTransaction.JournalDirectory, "*.json").Any(), "recovery is idempotent and removes completed record");
Reset();
using (var writer = new FileStream(Path.Combine(SaveFileTransaction.JournalDirectory, "writer.lock"),
    FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None))
    ExpectFailure(() => SaveFileTransaction.Commit(new(source, original, changed), new(target, original, changed)));
Check(File.ReadAllBytes(source).SequenceEqual(original) && File.ReadAllBytes(target).SequenceEqual(original),
    "competing writer is rejected before changing either save");
var newMule = Path.Combine(directory, "NewMule.d2s");
Reset();
SaveFileTransaction.AfterReplace = _ => throw new IOException("Simulated interruption after new file publish");
ExpectFailure(() => SaveFileTransaction.Commit(new(newMule, null, changed), new(source, original, changed)));
SaveFileTransaction.AfterReplace = null;
Check(!File.Exists(newMule) && File.ReadAllBytes(source).SequenceEqual(original), "new mule creation rolls back with source on failure");
SaveFileTransaction.Commit(new(newMule, null, changed), new(source, original, changed));
Check(File.ReadAllBytes(newMule).SequenceEqual(changed) && File.ReadAllBytes(source).SequenceEqual(changed), "new mule and existing source commit together");
ExpectFailure(() => SaveFileTransaction.Commit(new SaveFileTransaction.Update(newMule, null, original)));
Check(File.ReadAllBytes(newMule).SequenceEqual(changed), "new mule name collision never overwrites a file");
