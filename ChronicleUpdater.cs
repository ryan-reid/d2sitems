using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using D2SSharp.Data;
using D2SSharp.Enums;
using D2SSharp.Model;

namespace D2SItems;

public static class ChronicleUpdater
{
    private static readonly HashSet<string> QuestCodes = new(StringComparer.OrdinalIgnoreCase)
    {
        "ass", "bbb", "bkd", "bks", "box", "d33", "g33", "g34", "hdm", "hfh", "hst",
        "ice", "j34", "luv", "msf", "mss", "qbr", "qey", "qf1", "qf2", "qhr", "tr1",
        "tr2", "vip", "xyz"
    };

    public static int RunCli(string[] args, string defaultSaveDir, string defaultExcelDir)
    {
        bool dryRun = false;
        bool updateLive = false;
        string? customExcel = null;
        string? customStrings = null;
        var targetFiles = new List<string>();

        for (int i = 1; i < args.Length; i++)
        {
            var arg = args[i];
            if (arg == "--dry-run" || arg == "-n")
            {
                dryRun = true;
            }
            else if (arg == "--live" || arg == "-l")
            {
                updateLive = true;
            }
            else if ((arg == "--excel" || arg == "-e") && i + 1 < args.Length)
            {
                customExcel = args[++i];
            }
            else if ((arg == "--strings" || arg == "-s") && i + 1 < args.Length)
            {
                customStrings = args[++i];
            }
            else if ((arg == "--target" || arg == "-t") && i + 1 < args.Length)
            {
                targetFiles.Add(args[++i]);
            }
            else if (arg == "--help" || arg == "-h")
            {
                PrintHelp();
                return 0;
            }
            else if (!arg.StartsWith("-"))
            {
                targetFiles.Add(arg);
            }
        }

        Console.WriteLine("================================================================");
        Console.WriteLine(" BKDiablo In-Game Holy Grail Chronicle Auto-Updater");
        Console.WriteLine("================================================================");
        if (dryRun)
        {
            Console.WriteLine("[MODE] DRY RUN (No save files will be modified)\n");
        }

        // 1. Resolve Excel directory
        string excelDir = customExcel ?? defaultExcelDir;
        if (!File.Exists(Path.Combine(excelDir, "uniqueitems.txt")))
        {
            var fallbackSubmodule = Path.GetFullPath("mods/BKDiablo/bkdiablo.mpq/data/global/excel");
            var fallbackGame = @"E:\Games\Diablo II Resurrected\Mods\BKDiablo\bkdiablo.mpq\data\global\excel";

            if (File.Exists(Path.Combine(fallbackSubmodule, "uniqueitems.txt")))
                excelDir = fallbackSubmodule;
            else if (File.Exists(Path.Combine(fallbackGame, "uniqueitems.txt")))
                excelDir = fallbackGame;
            else
            {
                Console.Error.WriteLine($"[ERROR] Could not find uniqueitems.txt in {excelDir}");
                return 1;
            }
        }
        Console.WriteLine($"[EXCEL]   {excelDir}");

        // 2. Resolve Strings directory
        string? stringsDir = customStrings;
        if (string.IsNullOrEmpty(stringsDir))
        {
            var candidate1 = Path.Combine(Path.GetDirectoryName(Path.GetDirectoryName(excelDir)) ?? "", "local", "lng", "strings");
            var candidate2 = Path.GetFullPath("mods/BKDiablo/bkdiablo.mpq/data/local/lng/strings");
            var candidate3 = @"E:\Games\Diablo II Resurrected\Mods\BKDiablo\bkdiablo.mpq\data\local\lng\strings";

            if (Directory.Exists(candidate1) && File.Exists(Path.Combine(candidate1, "item-names.json")))
                stringsDir = candidate1;
            else if (Directory.Exists(candidate2) && File.Exists(Path.Combine(candidate2, "item-names.json")))
                stringsDir = candidate2;
            else if (Directory.Exists(candidate3) && File.Exists(Path.Combine(candidate3, "item-names.json")))
                stringsDir = candidate3;
        }
        Console.WriteLine($"[STRINGS] {stringsDir ?? "(none found - falling back to raw table keys)"}");

        // 3. Load String Tables
        var itemNames = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var keyToRuneword = new Dictionary<string, (uint Id, string Name)>(StringComparer.OrdinalIgnoreCase);
        var idToRunewordName = new Dictionary<uint, string>();

        if (!string.IsNullOrEmpty(stringsDir) && Directory.Exists(stringsDir))
        {
            var itemNamesPath = Path.Combine(stringsDir, "item-names.json");
            if (File.Exists(itemNamesPath))
            {
                try
                {
                    using var doc = JsonDocument.Parse(File.ReadAllText(itemNamesPath));
                    foreach (var elem in doc.RootElement.EnumerateArray())
                    {
                        if (elem.TryGetProperty("Key", out var kEl))
                        {
                            var k = kEl.GetString();
                            var en = elem.TryGetProperty("enUS", out var enEl) ? enEl.GetString() : k;
                            if (!string.IsNullOrEmpty(k) && !string.IsNullOrEmpty(en))
                                itemNames[k] = en;
                        }
                    }
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"[WARN] Could not parse item-names.json: {ex.Message}");
                }
            }

            var itemRunesPath = Path.Combine(stringsDir, "item-runes.json");
            if (File.Exists(itemRunesPath))
            {
                try
                {
                    using var doc = JsonDocument.Parse(File.ReadAllText(itemRunesPath));
                    foreach (var elem in doc.RootElement.EnumerateArray())
                    {
                        if (elem.TryGetProperty("Key", out var kEl) && elem.TryGetProperty("id", out var idEl))
                        {
                            var k = kEl.GetString();
                            var en = elem.TryGetProperty("enUS", out var enEl) ? (enEl.GetString() ?? k) : k;
                            if (!string.IsNullOrEmpty(k) && idEl.TryGetUInt32(out var rid))
                            {
                                keyToRuneword[k] = (rid, en ?? k);
                                idToRunewordName[rid] = en ?? k;
                            }
                        }
                    }
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"[WARN] Could not parse item-runes.json: {ex.Message}");
                }
            }
        }

        // 4. Scan Mod Catalog
        var catalogUniques = new Dictionary<uint, string>();
        var catalogSets = new Dictionary<uint, string>();
        var catalogRunewords = new Dictionary<uint, string>();

        // 4a. Unique Items
        var uniqueLines = File.ReadAllLines(Path.Combine(excelDir, "uniqueitems.txt"));
        if (uniqueLines.Length > 0)
        {
            var header = uniqueLines[0].Split('\t');
            int idIdx = Array.IndexOf(header, "*ID");
            int codeIdx = Array.IndexOf(header, "code");
            int nameIdx = Array.IndexOf(header, "index");
            int enabledIdx = Array.IndexOf(header, "enabled");
            int dcIdx = Array.IndexOf(header, "disableChronicle");

            for (int i = 1; i < uniqueLines.Length; i++)
            {
                var cols = uniqueLines[i].Split('\t');
                if (idIdx >= 0 && cols.Length > idIdx && uint.TryParse(cols[idIdx].Trim(), out var uid))
                {
                    var code = codeIdx >= 0 && cols.Length > codeIdx ? cols[codeIdx].Trim().ToLowerInvariant() : "";
                    var enabled = enabledIdx >= 0 && cols.Length > enabledIdx ? cols[enabledIdx].Trim() : "1";
                    var dc = dcIdx >= 0 && cols.Length > dcIdx ? cols[dcIdx].Trim() : "";
                    var rawName = nameIdx >= 0 && cols.Length > nameIdx ? cols[nameIdx].Trim() : $"Unique {uid}";
                    var displayName = itemNames.TryGetValue(rawName, out var localized) ? localized : rawName;

                    if (code.Length > 0 && enabled != "0" && dc != "1" && !QuestCodes.Contains(code))
                    {
                        catalogUniques[uid] = displayName;
                    }
                }
            }
        }

        // 4b. Set Items
        var setLines = File.ReadAllLines(Path.Combine(excelDir, "setitems.txt"));
        if (setLines.Length > 0)
        {
            var header = setLines[0].Split('\t');
            int idIdx = Array.IndexOf(header, "*ID");
            int codeIdx = Array.IndexOf(header, "item");
            int nameIdx = Array.IndexOf(header, "index");
            int dcIdx = Array.IndexOf(header, "disableChronicle");

            for (int i = 1; i < setLines.Length; i++)
            {
                var cols = setLines[i].Split('\t');
                if (idIdx >= 0 && cols.Length > idIdx && uint.TryParse(cols[idIdx].Trim(), out var sid))
                {
                    var code = codeIdx >= 0 && cols.Length > codeIdx ? cols[codeIdx].Trim().ToLowerInvariant() : "";
                    var dc = dcIdx >= 0 && cols.Length > dcIdx ? cols[dcIdx].Trim() : "";
                    var rawName = nameIdx >= 0 && cols.Length > nameIdx ? cols[nameIdx].Trim() : $"Set {sid}";
                    var displayName = itemNames.TryGetValue(rawName, out var localized) ? localized : rawName;

                    if (code.Length > 0 && dc != "1" && !QuestCodes.Contains(code))
                    {
                        catalogSets[sid] = displayName;
                    }
                }
            }
        }

        // 4c. Runewords
        var runesLines = File.ReadAllLines(Path.Combine(excelDir, "runes.txt"));
        if (runesLines.Length > 0)
        {
            var header = runesLines[0].Split('\t');
            int nameIdx = Array.IndexOf(header, "Name");
            int completeIdx = Array.IndexOf(header, "complete");
            int rune1Idx = Array.IndexOf(header, "Rune1");

            for (int i = 1; i < runesLines.Length; i++)
            {
                var cols = runesLines[i].Split('\t');
                if (nameIdx >= 0 && cols.Length > nameIdx)
                {
                    var key = cols[nameIdx].Trim();
                    var complete = completeIdx >= 0 && cols.Length > completeIdx ? cols[completeIdx].Trim() : "";
                    var rune1 = rune1Idx >= 0 && cols.Length > rune1Idx ? cols[rune1Idx].Trim() : "";

                    if (complete == "1" && rune1.Length > 0 && keyToRuneword.TryGetValue(key, out var rinfo))
                    {
                        catalogRunewords[rinfo.Id] = rinfo.Name;
                    }
                }
            }
        }

        // Include special runewords like 20562 (Revenge) if present in item-runes.json
        if (keyToRuneword.TryGetValue("Runeword56", out var rw56))
        {
            catalogRunewords[rw56.Id] = rw56.Name;
        }

        Console.WriteLine($"\n[CATALOG] Found {catalogUniques.Count} Uniques, {catalogSets.Count} Sets, {catalogRunewords.Count} Runewords (Total: {catalogUniques.Count + catalogSets.Count + catalogRunewords.Count})");

        // 5. Determine Target Stashes
        if (targetFiles.Count == 0)
        {
            var exportSoft = Path.GetFullPath("exports/100pct_chronicle/ModernSharedStashSoftCoreV2.d2i");
            var exportHard = Path.GetFullPath("exports/100pct_chronicle/ModernSharedStashHardCoreV2.d2i");
            if (File.Exists(exportSoft)) targetFiles.Add(exportSoft);
            if (File.Exists(exportHard)) targetFiles.Add(exportHard);

            if (updateLive)
            {
                var liveSoft = Path.Combine(defaultSaveDir, "ModernSharedStashSoftCoreV2.d2i");
                var liveHard = Path.Combine(defaultSaveDir, "ModernSharedStashHardCoreV2.d2i");
                if (File.Exists(liveSoft)) targetFiles.Add(liveSoft);
                if (File.Exists(liveHard)) targetFiles.Add(liveHard);
            }
        }

        if (targetFiles.Count == 0)
        {
            Console.WriteLine("[WARN] No target shared stash (.d2i) files found to update.");
            return 0;
        }

        var external = new TxtFileExternalData(excelDir, 105);
        var engine = new SaveInspectorEngine(excelDir, null, null, null);
        int totalUpdatedFiles = 0;

        foreach (var targetPath in targetFiles.Distinct(StringComparer.OrdinalIgnoreCase))
        {
            if (!File.Exists(targetPath))
            {
                Console.WriteLine($"[SKIP] File not found: {targetPath}");
                continue;
            }

            Console.WriteLine($"\n----------------------------------------------------------------");
            Console.WriteLine($"Processing: {Path.GetFileName(targetPath)}");
            Console.WriteLine($"Location:   {targetPath}");

            byte[] rawBytes = File.ReadAllBytes(targetPath);
            D2StashSave stash;
            try
            {
                stash = D2StashSave.Read(rawBytes, external);
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[ERROR] Failed to read stash file: {ex.Message}");
                continue;
            }

            int chronicleTabIdx = -1;
            for (int t = 0; t < stash.Count; t++)
            {
                if (stash[t].TabType == StashTabType.Chronicle || stash[t].Chronicle != null)
                {
                    chronicleTabIdx = t;
                    break;
                }
            }

            if (chronicleTabIdx < 0 || stash[chronicleTabIdx].Chronicle == null)
            {
                Console.WriteLine("[WARN] Stash does not contain a Chronicle tab. Skipping.");
                continue;
            }

            var chronicle = stash[chronicleTabIdx].Chronicle!;
            chronicle.UniqueEntries ??= new List<ChronicleEntry>();
            chronicle.SetEntries ??= new List<ChronicleEntry>();
            chronicle.RunewordEntries ??= new List<ChronicleEntry>();

            var existingUniqueIds = new HashSet<uint>(chronicle.UniqueEntries.Select(e => e.ItemId));
            var existingSetIds = new HashSet<uint>(chronicle.SetEntries.Select(e => e.ItemId));
            var existingRunewordIds = new HashSet<uint>(chronicle.RunewordEntries.Select(e => e.ItemId));

            var missingUniques = catalogUniques.Where(kv => !existingUniqueIds.Contains(kv.Key)).ToList();
            var missingSets = catalogSets.Where(kv => !existingSetIds.Contains(kv.Key)).ToList();
            var missingRunewords = catalogRunewords.Where(kv => !existingRunewordIds.Contains(kv.Key)).ToList();

            int totalMissing = missingUniques.Count + missingSets.Count + missingRunewords.Count;

            Console.WriteLine($"Current Stash: {chronicle.UniqueEntries.Count} Uniques, {chronicle.SetEntries.Count} Sets, {chronicle.RunewordEntries.Count} Runewords (Total: {chronicle.UniqueEntries.Count + chronicle.SetEntries.Count + chronicle.RunewordEntries.Count})");

            if (totalMissing == 0)
            {
                Console.WriteLine("[STATUS] 100% Up to date! No new items need to be added.");
                continue;
            }

            Console.WriteLine($"[STATUS] Detected {totalMissing} new item(s) to add to Chronicle:");
            if (missingUniques.Count > 0)
            {
                Console.WriteLine($"  + {missingUniques.Count} New Unique Item(s):");
                foreach (var (id, name) in missingUniques)
                    Console.WriteLine($"    - ID {id}: {name}");
            }
            if (missingSets.Count > 0)
            {
                Console.WriteLine($"  + {missingSets.Count} New Set Item(s):");
                foreach (var (id, name) in missingSets)
                    Console.WriteLine($"    - ID {id}: {name}");
            }
            if (missingRunewords.Count > 0)
            {
                Console.WriteLine($"  + {missingRunewords.Count} New Runeword(s):");
                foreach (var (id, name) in missingRunewords)
                    Console.WriteLine($"    - ID {id}: {name}");
            }

            if (dryRun)
            {
                Console.WriteLine("[DRY RUN] Skipping file serialization.");
                continue;
            }

            // Create Safety Backup
            string backupPath = targetPath + ".bak";
            File.Copy(targetPath, backupPath, overwrite: true);
            Console.WriteLine($"[BACKUP] Created {Path.GetFileName(backupPath)}");

            // Append missing entries
            uint defaultTimestamp = 29900000;
            ushort defaultSource = 0;

            foreach (var (id, _) in missingUniques)
                chronicle.UniqueEntries.Add(new ChronicleEntry { ItemId = id, Source = defaultSource, Timestamp = defaultTimestamp });
            foreach (var (id, _) in missingSets)
                chronicle.SetEntries.Add(new ChronicleEntry { ItemId = id, Source = defaultSource, Timestamp = defaultTimestamp });
            foreach (var (id, _) in missingRunewords)
                chronicle.RunewordEntries.Add(new ChronicleEntry { ItemId = id, Source = defaultSource, Timestamp = defaultTimestamp });

            chronicle.UniqueEntries = chronicle.UniqueEntries.OrderBy(e => e.ItemId).ToList();
            chronicle.SetEntries = chronicle.SetEntries.OrderBy(e => e.ItemId).ToList();
            chronicle.RunewordEntries = chronicle.RunewordEntries.OrderBy(e => e.ItemId).ToList();

            // Re-serialize
            byte[] updatedBytes = stash.ToBytes(external, 105);
            File.WriteAllBytes(targetPath, updatedBytes);

            // Verify
            var verifyStash = D2StashSave.Read(File.ReadAllBytes(targetPath), external);
            var verifyChronicle = verifyStash[chronicleTabIdx].Chronicle!;
            Console.WriteLine($"[VERIFY] Verified stash contains {verifyChronicle.UniqueEntries?.Count} Uniques, {verifyChronicle.SetEntries?.Count} Sets, {verifyChronicle.RunewordEntries?.Count} Runewords.");

            // Regenerate companion JSON
            try
            {
                string jsonOutput = engine.ProcessSharedStashToJson(targetPath, updatedBytes);
                string jsonPath = Path.ChangeExtension(targetPath, ".json");
                File.WriteAllText(jsonPath, jsonOutput);
                Console.WriteLine($"[JSON]   Regenerated companion: {Path.GetFileName(jsonPath)}");
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[WARN] Could not regenerate JSON: {ex.Message}");
            }

            totalUpdatedFiles++;
        }

        // 6. Update user_chronicle_100pct.json if exports directory exists
        string exportDir = Path.GetFullPath("exports/100pct_chronicle");
        if (Directory.Exists(exportDir) && !dryRun)
        {
            var allNames = new Dictionary<string, bool>(StringComparer.OrdinalIgnoreCase);
            foreach (var name in catalogUniques.Values) allNames[name.Trim().ToLowerInvariant()] = true;
            foreach (var name in catalogSets.Values) allNames[name.Trim().ToLowerInvariant()] = true;
            foreach (var name in catalogRunewords.Values) allNames[name.Trim().ToLowerInvariant()] = true;

            var json100Path = Path.Combine(exportDir, "user_chronicle_100pct.json");
            var options = new JsonSerializerOptions { WriteIndented = true };
            File.WriteAllText(json100Path, JsonSerializer.Serialize(allNames, options));
            Console.WriteLine($"\n[EXPORT] Updated 100% Web UI checklist: {json100Path} ({allNames.Count} entries)");
        }

        Console.WriteLine("\n================================================================");
        Console.WriteLine(dryRun ? " Dry Run Completed." : $" Chronicle Update Completed! ({totalUpdatedFiles} file(s) updated)");
        Console.WriteLine("================================================================\n");

        return 0;
    }

    private static void PrintHelp()
    {
        Console.WriteLine(@"Usage:
  dotnet run -- update-chronicle [options] [stash_files...]
  python scripts/update_100pct_chronicle.py [options]

Description:
  Scans mod game data tables (uniqueitems.txt, setitems.txt, runes.txt, item-runes.json)
  for newly added items and automatically injects them into the in-game Holy Grail
  Chronicle tab of the target .d2i stash saves (exports and/or live saves).

Options:
  --dry-run, -n         Preview what new items would be added without modifying files
  --live, -l            Also update active game saves in %USERPROFILE%\Saved Games
  --excel, -e <path>    Specify path to mod excel directory
  --strings, -s <path>  Specify path to mod strings directory (JSON)
  --target, -t <path>   Specify explicit .d2i stash file(s) to update
  --help, -h            Show this help text
");
    }
}
