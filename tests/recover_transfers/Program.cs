using D2SItems;
using D2SSharp.Data;
using D2SSharp.Model;
using System.Security.Cryptography;

if (args.Length != 2) throw new ArgumentException("Usage: RecoverTransfers <BKDiablo save directory> <excel directory>");
if (System.Diagnostics.Process.GetProcessesByName("D2R").Length != 0)
    throw new IOException("Close Diablo II before restoring saves.");
var root = Path.GetFullPath(args[0]);
var external = new TxtFileExternalData(args[1], 105);
var originals = new[] {
    ("ModernSharedStashHardCoreV2.d2i", "20261003_203409_8983949_7d11847c9d944eb38b5e09a43dd5f5aa_ModernSharedStashHardCoreV2.d2i"),
    ("TestBarb.d2s", "20261003_203409_9107678_18cae69ae7944e03a95884700fdb40be_TestBarb.d2s"),
    ("TestAmazon.d2s", "20261003_203425_3354994_1b0fdf2c04104dd4885f3bcfb7cec575_TestAmazon.d2s")
};
var updates = originals.Select(pair => {
    var path = Path.Combine(root, pair.Item1);
    var replacement = File.ReadAllBytes(Path.Combine(root, "backups", pair.Item2));
    if (path.EndsWith(".d2i")) D2StashSave.Read(replacement, external);
    else D2Save.Read(replacement, external);
    return new SaveFileTransaction.Update(path, File.ReadAllBytes(path), replacement);
}).ToArray();
var backups = SaveFileTransaction.Commit(updates);
for (int i = 0; i < updates.Length; i++)
{
    var update = updates[i];
    if (!File.ReadAllBytes(update.Path).SequenceEqual(update.Replacement)) throw new IOException("Restored bytes differ: " + update.Path);
    if (!File.ReadAllBytes(backups[i]).SequenceEqual(update.Original)) throw new IOException("Safety backup differs: " + backups[i]);
    Console.WriteLine($"RESTORED {Path.GetFileName(update.Path)}: {update.Replacement.Length} bytes; SHA256={Convert.ToHexString(SHA256.HashData(update.Replacement))}\nCurrent-state backup: {backups[i]}");
}
