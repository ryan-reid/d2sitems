using D2SItems;
using D2SSharp.Data;
using D2SSharp.Model;
using D2SSharp.Enums;

if (args.Length != 2) throw new ArgumentException("Usage: ClearWindy <save.d2s> <mod excel directory>");
if (System.Diagnostics.Process.GetProcessesByName("D2R").Length != 0)
    throw new IOException("Close Diablo II before repairing the save.");
var path = Path.GetFullPath(args[0]);
var external = new TxtFileExternalData(args[1], version: 105);
var original = File.ReadAllBytes(path);
var save = D2Save.Read(original, external);
var before = save.Character.Flags;
if (!before.HasFlag(CharacterFlags.Hardcore)) throw new InvalidDataException("Expected a hardcore character.");
if (!before.HasFlag(CharacterFlags.Dead)) { Console.WriteLine("Already alive; no changes made."); return; }
save.Character.Flags &= ~CharacterFlags.Dead;
var replacement = save.ToBytes(external, 105);
// Version 105 uses the compact header: status at 20, checksum at 12..15.
if (replacement.Length != original.Length) throw new InvalidDataException("Serialization changed save size; refusing repair.");
var differences = Enumerable.Range(0, original.Length).Where(i => original[i] != replacement[i]).ToArray();
if (BitConverter.ToUInt32(original, 4) != 105) throw new InvalidDataException("Expected version 105.");
if (differences.Any(i => i != 20 && (i < 12 || i > 15)) || (original[20] ^ replacement[20]) != 8)
    throw new InvalidDataException("Unexpected byte changes; refusing repair: " + string.Join(",", differences));
var verified = D2Save.Read(replacement, external);
if (verified.Character.Flags != (before & ~CharacterFlags.Dead)) throw new InvalidDataException("Flag verification failed.");
var backup = SaveFileTransaction.Commit(new SaveFileTransaction.Update(path, original, replacement))[0];
if (!File.ReadAllBytes(path).SequenceEqual(replacement)) throw new IOException("Readback verification failed.");
Console.WriteLine($"Repaired {path}\nFlags: {(int)before} -> {(int)verified.Character.Flags}\nBytes: {original.Length}; changed offsets: {string.Join(",", differences)}\nBackup: {backup}");
