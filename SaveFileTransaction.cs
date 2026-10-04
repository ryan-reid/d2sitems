using System.Security.Cryptography;
using System.Text.Json;

namespace D2SItems;

/// <summary>Durable undo records protect cooperating disk writers and allow restart recovery.</summary>
public static class SaveFileTransaction
{
    public sealed record Update(string Path, byte[]? Original, byte[] Replacement);
    public sealed record Entry(string Path, string Backup, string Before, string After, string? Stage = null, bool Created = false);
    internal static Action<int>? AfterReplace { get; set; }
    internal static string JournalDirectory = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "BKDiabloEditor", "transactions");

    private static FileStream Lock()
    {
        Directory.CreateDirectory(JournalDirectory);
        // Fail immediately when another editor process is writing; never queue stale requests.
        return new FileStream(Path.Combine(JournalDirectory, "writer.lock"), FileMode.OpenOrCreate,
            FileAccess.ReadWrite, FileShare.None);
    }

    public static void RecoverPending()
    {
        using var guard = Lock();
        RecoverLocked();
    }

    public static void VerifyRevision(byte[] bytes, string? revision)
    {
        if (revision != null && !Hash(bytes).Equals(revision, StringComparison.OrdinalIgnoreCase))
            throw new IOException("Save revision changed; rescan before editing.");
    }

    private static string Hash(byte[] bytes) => Convert.ToHexString(SHA256.HashData(bytes));

    private static void RecoverLocked()
    {
        foreach (var journal in Directory.EnumerateFiles(JournalDirectory, "*.json"))
        {
            var entries = JsonSerializer.Deserialize<Entry[]>(File.ReadAllBytes(journal))
                ?? throw new IOException($"Invalid recovery record: {journal}");
            // Validate the entire set before touching any file. Unknown revisions require human recovery.
            foreach (var entry in entries)
            {
                if (entry.Created)
                {
                    if (File.Exists(entry.Path) && Hash(File.ReadAllBytes(entry.Path)) != entry.After)
                        throw new IOException($"Recovery conflict for new file: {entry.Path}");
                    continue;
                }
                var current = Hash(File.ReadAllBytes(entry.Path));
                if ((current != entry.Before && current != entry.After)
                    || Hash(File.ReadAllBytes(entry.Backup)) != entry.Before)
                    throw new IOException($"Recovery conflict; preserve saves and restore from record: {journal}");
            }
            foreach (var entry in entries.Reverse())
            {
                if (entry.Created) { File.Delete(entry.Path); continue; }
                if (Hash(File.ReadAllBytes(entry.Path)) == entry.Before) continue;
                var stage = entry.Path + $".{Guid.NewGuid():N}.pending";
                try
                {
                    WriteDurable(stage, File.ReadAllBytes(entry.Backup));
                    File.Replace(stage, entry.Path, null);
                }
                finally { TryDelete(stage); }
            }
            foreach (var entry in entries) if (entry.Stage != null) TryDelete(entry.Stage);
            File.Delete(journal);
            Console.Error.WriteLine($"[RECOVERY] Restored interrupted transaction: {journal}");
        }
    }

    public static string[] Commit(params Update[] updates)
    {
        using var guard = Lock();
        RecoverLocked();
        var paths = updates.Select(u => Path.GetFullPath(u.Path)).ToArray();
        if (paths.Distinct(StringComparer.OrdinalIgnoreCase).Count() != paths.Length)
            throw new ArgumentException("A save may only appear once in a transaction.");
        var stages = new List<string>();
        var entries = new List<Entry>();
        var journal = Path.Combine(JournalDirectory, Guid.NewGuid().ToString("N") + ".json");
        bool recorded = false;
        try
        {
            for (int i = 0; i < updates.Length; i++)
            {
                VerifyOriginal(paths[i], updates[i].Original);
                if (File.Exists(paths[i]) && (File.GetAttributes(paths[i]) & FileAttributes.ReadOnly) != 0)
                    throw new IOException($"Save is read-only: {paths[i]}");
                var stage = paths[i] + $".{Guid.NewGuid():N}.pending";
                stages.Add(stage);
                WriteDurable(stage, updates[i].Replacement);
                if (updates[i].Original == null)
                {
                    entries.Add(new(paths[i], "", "", Hash(updates[i].Replacement), stage, true));
                    continue;
                }
                var backup = SaveBackup.CreateBackup(paths[i])
                    ?? throw new IOException($"Save disappeared: {paths[i]}");
                // Flush and validate the actual backup before publishing the recovery record.
                using (var stream = new FileStream(backup, FileMode.Open, FileAccess.ReadWrite, FileShare.Read))
                    stream.Flush(true);
                VerifyOriginal(backup, updates[i].Original);
                entries.Add(new(paths[i], backup, Hash(updates[i].Original!), Hash(updates[i].Replacement), stage));
            }
            var recordStage = journal + ".pending";
            try
            {
                WriteDurable(recordStage, JsonSerializer.SerializeToUtf8Bytes(entries));
                File.Move(recordStage, journal);
                recorded = true;
            }
            finally { TryDelete(recordStage); }
            for (int i = 0; i < updates.Length; i++)
            {
                VerifyOriginal(paths[i], updates[i].Original);
                if (updates[i].Original == null) File.Move(stages[i], paths[i]);
                else File.Replace(stages[i], paths[i], null);
                AfterReplace?.Invoke(i);
            }
            // Removing the undo record is the commit point. A crash before this rolls back on restart.
            File.Delete(journal);
            return entries.Select(e => e.Backup).ToArray();
        }
        catch (Exception failure)
        {
            if (recorded)
            {
                try { RecoverLocked(); }
                catch (Exception recovery)
                {
                    throw new IOException($"{failure.Message} Manual recovery required: {journal}. {recovery.Message}", failure);
                }
            }
            throw new IOException($"{failure.Message} No committed changes remain. Backups: {string.Join(", ", entries.Select(e => e.Backup))}", failure);
        }
        finally { foreach (var stage in stages) TryDelete(stage); }
    }

    private static void WriteDurable(string path, byte[] bytes)
    {
        using var stream = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None);
        stream.Write(bytes);
        stream.Flush(true);
    }

    private static void TryDelete(string path)
    {
        try { File.Delete(path); }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
    }

    private static void VerifyOriginal(string path, byte[]? expected)
    {
        if (expected == null)
        {
            if (File.Exists(path)) throw new IOException($"New save name is already in use: {path}");
            return;
        }
        if (!File.ReadAllBytes(path).AsSpan().SequenceEqual(expected))
            throw new IOException($"Save changed since it was read; reload before editing: {path}");
    }
}
