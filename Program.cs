using D2SSharp.Data;
using D2SSharp.Model;
using D2SSharp.Enums;
using System.Diagnostics;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

// Load config file (looks next to the executable, then in the current directory)
var config = LoadConfig("d2sitems.conf");

var excelDir = config.GetValueOrDefault("excel_dir",
    @"C:\Program Files (x86)\Diablo II Resurrected\data\global\excel");
var defaultSaveDir = config.GetValueOrDefault("save_dir",
    Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
        "Saved Games", "Diablo II Resurrected"));

// Check for --monitor mode
if (args.Length >= 2 && args[0] == "--monitor")
{
    var monitorCharName = args[1];
    var monitorFile = Path.Combine(defaultSaveDir, $"{monitorCharName}.d2s");
    if (!File.Exists(monitorFile))
    {
        // Try as a direct path
        if (File.Exists(monitorCharName))
            monitorFile = monitorCharName;
        else
        {
            Console.WriteLine($"File not found: {monitorFile}");
            return;
        }
    }
    // Need to load lookups before monitoring - fall through to load them,
    // then run monitor mode after
    args = new[] { "__monitor__", monitorFile };
}

var fileArgs = args.Where(a => a != "__monitor__").ToList();
var isMonitorMode = args.Length >= 1 && args[0] == "__monitor__";

// Default to the configured save directory if no files specified
if (!isMonitorMode && fileArgs.Count == 0)
{
    if (Directory.Exists(defaultSaveDir))
    {
        fileArgs.Add(defaultSaveDir);
        Console.WriteLine($"No files specified, using default directory: {defaultSaveDir}");
    }
    else
    {
        Console.WriteLine("Usage: d2sitems [--monitor <charactername>] [file.d2s|file.d2i|dir] ...");
        Console.WriteLine($"Default directory not found: {defaultSaveDir}");
        return;
    }
}

// Expand arguments: directories become all .d2s and .d2i files within them
var saveFiles = new List<string>();
foreach (var arg in fileArgs)
{
    if (Directory.Exists(arg))
    {
        saveFiles.AddRange(Directory.GetFiles(arg, "*.d2s"));
        saveFiles.AddRange(Directory.GetFiles(arg, "*.d2i"));
    }
    else
        saveFiles.Add(arg);
}

// Build lookups from game_files/default/excel (shared across all files)
int missingFileCount = 0;
var stringTable = BuildStringTable(excelDir);
var itemNames = BuildItemNameLookup(excelDir, stringTable);
var skillNames = BuildSkillNameLookup(excelDir, stringTable);
var runewordsByRunes = BuildRunewordLookup(excelDir, stringTable);
var uniqueItemNames = BuildUniqueItemNameLookup(excelDir, stringTable);
var setItemNames = BuildSetItemNameLookup(excelDir, stringTable);
var gemApplyTypes = BuildGemApplyTypeLookup(excelDir);
var gemStats = BuildGemStatsLookup(excelDir);
var propertyToStats = BuildPropertyToStatsLookup(excelDir);
var statNameToId = BuildStatNameToIdLookup(excelDir);
var itemTiers = BuildItemTierLookup(excelDir);
var itemTypes = BuildItemTypeLookup(excelDir);
var setItemSetNames = BuildSetItemSetNameLookup(excelDir);
var itemDefenseRanges = BuildItemDefenseRangeLookup(excelDir);
var uniqueStatRanges = BuildUniqueStatRangesLookup(excelDir);
var setStatRanges = BuildSetStatRangesLookup(excelDir);
var runewordStatRanges = BuildRunewordStatRangesLookup(excelDir);

// Set up external data for D2SSharp to use the configured excel files
IExternalData externalData;
try
{
    externalData = new TxtFileExternalData(excelDir, version: 105);
}
catch (Exception ex)
{
    Console.WriteLine($"Error: could not load external data from {excelDir}: {ex.Message}");
    return;
}

if (missingFileCount > 0)
{
    Console.Write($"{missingFileCount} game file(s) could not be loaded. Continue anyway? (y/n) ");
    var response = Console.ReadLine()?.Trim().ToLowerInvariant();
    if (response != "y" && response != "yes")
    {
        Console.WriteLine("Exiting.");
        return;
    }
}

var jsonOptions = new JsonSerializerOptions
{
    WriteIndented = true,
    DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping
};

// In monitor mode, process all files in save_dir and mule_dir
if (isMonitorMode)
{
    saveFiles.Clear();
    if (Directory.Exists(defaultSaveDir))
    {
        saveFiles.AddRange(Directory.GetFiles(defaultSaveDir, "*.d2s"));
        saveFiles.AddRange(Directory.GetFiles(defaultSaveDir, "*.d2i"));
    }
    var muleDir = config.GetValueOrDefault("mule_dir", "");
    if (muleDir.Length > 0 && Directory.Exists(muleDir))
    {
        saveFiles.AddRange(Directory.GetFiles(muleDir, "*.d2s"));
    }
}

// Process all save and stash files
Console.WriteLine($"Processing {saveFiles.Count} save and stash files");
foreach (var saveFile in saveFiles)
{
    if (!File.Exists(saveFile))
    {
        Console.WriteLine($"  File not found: {saveFile}");
        continue;
    }

    var ext = Path.GetExtension(saveFile).ToLowerInvariant();
    byte[] saveBytes = File.ReadAllBytes(saveFile);

    try
    {
        if (ext == ".d2i")
            ProcessSharedStash(saveFile, saveBytes);
        else
            ProcessCharacterSave(saveFile, saveBytes);
    }
    catch (Exception ex)
    {
        Console.WriteLine($"  ERROR processing {saveFile}: {ex.Message}");
    }
}

// Monitor mode: watch a character for new unique/set items
if (isMonitorMode)
{
    var monitorFile = fileArgs[0];
    var monitorInterval = int.TryParse(config.GetValueOrDefault("monitor_interval", "5"), out var mi) ? mi : 5;
    var beepSettings = config.GetValueOrDefault("beep", "none")
        .Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries)
        .Select(s => s.ToLowerInvariant()).ToHashSet();
    bool beepOnFound = beepSettings.Contains("found");
    bool beepOnBest = beepOnFound ? false : beepSettings.Contains("best");
    bool beepOnNew = beepOnFound ? false : beepSettings.Contains("new");
    // Determine the matching shared stash file for this character
    string? monitorStashFile = null;
    try
    {
        var initBytes = File.ReadAllBytes(monitorFile);
        var initSave = D2Save.Read(initBytes, externalData);
        var charGameVersion = initSave.Character.Preview.GameVersion.ToString();
        var charCore = initSave.Character.Flags.HasFlag(CharacterFlags.Hardcore) ? "HardCore" : "SoftCore";
        var stashPrefix = charGameVersion == "ReignOfTheWarlock" ? "Modern" : "";
        var stashName = $"{stashPrefix}SharedStash{charCore}V2.d2i";
        var stashPath = Path.Combine(defaultSaveDir, stashName);
        if (File.Exists(stashPath))
        {
            monitorStashFile = stashPath;
            Console.WriteLine($"Also refreshing shared stash: {Path.GetFileName(monitorStashFile)}");
        }
    }
    catch (Exception ex)
    {
        Console.WriteLine($"Warning: could not read character for stash detection: {ex.Message}");
    }

    Console.WriteLine($"Monitoring {monitorFile} for new unique/set items every {monitorInterval}s (Ctrl+C to stop)...");

    var findScript = Path.Combine(Directory.GetCurrentDirectory(), "find_items.py");
    if (!File.Exists(findScript))
        findScript = Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "find_items.py");

    Dictionary<string, Item> previousItems = new();
    bool firstRun = true;

    while (true)
    {
        try
        {
            byte[] saveBytes = File.ReadAllBytes(monitorFile);
            D2Save save = D2Save.Read(saveBytes, externalData);

            var allItems = new List<Item>(save.Items);
            if (save.MercItems != null)
                foreach (var item in save.MercItems.Items)
                    allItems.Add(item);

            // Collect current unique/set items by name
            var currentItems = new Dictionary<string, Item>();
            foreach (var item in allItems)
            {
                if (item.Quality is ItemQuality.Unique or ItemQuality.Set
                    && item.Flags.HasFlag(ItemFlags.Identified))
                {
                    var name = GetItemDisplayName(item);
                    currentItems.TryAdd(name, item);
                }
            }

            if (!firstRun)
            {
                foreach (var (name, item) in currentItems)
                {
                    if (!previousItems.ContainsKey(name))
                    {
                        var timestamp = DateTime.Now.ToString("HH:mm:ss");
                        var statRanges = GetStatRangesForItem(item);
                        var score = CalculatePerfectionScore(item, statRanges);
                        var scoreStr = score.HasValue ? $" - (Perfection: {score:F2}%)" : " - (No Perfection Score)";
                        var ethStr = item.Flags.HasFlag(ItemFlags.Ethereal) ? " [ETH]" : "";
                        if (beepOnFound) Console.Beep();
                        Console.WriteLine($"\n------\n");
                        Console.WriteLine($"[{timestamp}] NEW ITEM DETECTED: {name}{ethStr}{scoreStr}");
                        if (score.HasValue)
                        {

                            // Print stats with ranges
                            if (item.Defense.HasValue)
                            {
                                var baseRange = GetBaseDefenseRange(item.ItemCodeString);
                                if (baseRange != null)
                                    Console.WriteLine($"  Defense: {item.Defense} (base: {baseRange})");
                                else
                                    Console.WriteLine($"  Defense: {item.Defense}");
                            }
                            var allMonStats = new List<Stat>();
                            if (item.RunewordStats != null) allMonStats.AddRange(item.RunewordStats);
                            if (item.Stats != null) allMonStats.AddRange(item.Stats);
                            foreach (var stat in allMonStats)
                            {
                                var text = FormatStat(stat);
                                if (statRanges != null && statRanges.TryGetValue(((int)stat.Id, stat.Layer), out var range) && range.Min != range.Max)
                                    Console.WriteLine($"  {text} [{range.Min}-{range.Max}]");
                                else
                                    Console.WriteLine($"  {text}");
                            }
                        }

                        // Refresh shared stash JSON before searching
                        if (monitorStashFile != null)
                        {
                            try
                            {
                                var stashBytes = File.ReadAllBytes(monitorStashFile);
                                ProcessSharedStash(monitorStashFile, stashBytes);
                            }
                            catch { }
                        }

                        // Find existing copies across all saves
                        var existing = FindExistingItems(name, findScript);
                        bool isBest = false;
                        bool itemEthereal = item.Flags.HasFlag(ItemFlags.Ethereal);
                        int existingEth = 0, existingNonEth = 0;
                        foreach (var copy in existing)
                        {
                            bool copyEth = false;
                            if (copy.TryGetProperty("flags", out var fl))
                                foreach (var f in fl.EnumerateArray())
                                    if (f.GetString() == "Ethereal") { copyEth = true; break; }
                            if (copyEth) existingEth++; else existingNonEth++;
                        }
                        if (existing.Count == 0)
                        {
                            Console.WriteLine($"************** This is your first one! ***************");
                            isBest = true;
                            if (beepOnNew) Console.Beep();
                        }
                        else
                        {
                            Console.WriteLine($"  You already have {existing.Count} of this item.");
                            if (itemEthereal && existingEth == 0)
                                Console.WriteLine($"************** This is your first ETHEREAL one! ***************");
                            else if (!itemEthereal && existingNonEth == 0)
                                Console.WriteLine($"************** This is your first NON-ETHEREAL one! ***************");
                            isBest = true;
                            foreach (var copy in existing)
                            {
                                var charName = copy.TryGetProperty("character", out var cn) ? cn.GetString() : "?";
                                bool copyEthereal = false;
                                if (copy.TryGetProperty("flags", out var fl))
                                    foreach (var f in fl.EnumerateArray())
                                        if (f.GetString() == "Ethereal") { copyEthereal = true; break; }
                                var copyEthStr = copyEthereal ? " [ETH]" : "";
                                if (copy.TryGetProperty("perfectionScore", out var ps))
                                {
                                    var copyScore = ps.GetDouble();
                                    var scoreVal = score!.Value;
                                    var comparison = scoreVal > copyScore ? "THE NEW ONE IS BETTER"
                                        : scoreVal < copyScore ? "the new one is worse"
                                        : "same score";
                                    Console.WriteLine($"    Copy on {charName}{copyEthStr} scored {copyScore:F2}%. {comparison}.");
                                    if (copyScore >= scoreVal)
                                        isBest = false;
                                }
                                else
                                {
                                    Console.WriteLine($"    Copy on [{charName}]{copyEthStr}");
                                }

                                if (score.HasValue)
                                {
                                    // Show defense for armor
                                    if (copy.TryGetProperty("defense", out var defEl))
                                    {
                                        var baseRangeStr = copy.TryGetProperty("baseDefenseRange", out var br) ? br.GetString() : null;
                                        if (baseRangeStr != null)
                                            Console.WriteLine($"      Defense: {defEl.GetInt32()} (base: {baseRangeStr})");
                                        else
                                            Console.WriteLine($"      Defense: {defEl.GetInt32()}");
                                    }
                                    // Print stats of existing copy
                                    foreach (var statList in new[] { "runewordStats", "stats" })
                                    {
                                        if (copy.TryGetProperty(statList, out var stats))
                                        {
                                            foreach (var s in stats.EnumerateArray())
                                            {
                                                var desc = s.TryGetProperty("description", out var d) ? d.GetString() : "?";
                                                var rangeStr = s.TryGetProperty("range", out var r) ? $" [{r.GetString()}]" : "";
                                                Console.WriteLine($"      {desc}{rangeStr}");
                                            }
                                        }
                                    }
                                }

                            }
                            if (score.HasValue && isBest)
                            {
                                Console.WriteLine($"************** NEW BEST! ***************");
                                if (beepOnBest) Console.Beep();
                            }
                        }
                    }
                }
            }
            else
            {
                Console.WriteLine($"Loaded {currentItems.Count} unique/set items. Watching for changes...");
                firstRun = false;
            }

            previousItems = currentItems;
        }
        catch (Exception ex)
        {
            // File might be locked during save, just skip this cycle
            Console.WriteLine($"  (read error, retrying: {ex.Message})");
        }

        Thread.Sleep(monitorInterval * 1000);
    }
}

List<JsonElement> FindExistingItems(string itemName, string findScript)
{
    var pythonCmd = config.GetValueOrDefault("python", "python");
    try
    {
        var escapedName = $"^{Regex.Escape(itemName)}$";
        var psi = new ProcessStartInfo
        {
            FileName = pythonCmd,
            ArgumentList = { findScript, "--name", escapedName, "--json" },
            UseShellExecute = false,
            RedirectStandardOutput = true
        };
        var proc = Process.Start(psi);
        if (proc == null) return new();
        var output = proc.StandardOutput.ReadToEnd();
        proc.WaitForExit();
        var results = JsonSerializer.Deserialize<JsonElement>(output);
        var list = new List<JsonElement>();
        foreach (var el in results.EnumerateArray())
            list.Add(el);
        return list;
    }
    catch
    {
        Console.WriteLine($"  Make sure python is installed and runnable.  You can set the python command in d2sitems.conf.");
        return new();
    }
}

// Monitor mode: watch a character for new unique/set items
if (isMonitorMode)
{
    var monitorFile = fileArgs[0];
    var monitorInterval = int.TryParse(config.GetValueOrDefault("monitor_interval", "5"), out var mi) ? mi : 5;
    var beepSettings = config.GetValueOrDefault("beep", "none")
        .Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries)
        .Select(s => s.ToLowerInvariant()).ToHashSet();
    bool beepOnFound = beepSettings.Contains("found");
    bool beepOnBest = beepOnFound ? false : beepSettings.Contains("best");
    bool beepOnNew = beepOnFound ? false : beepSettings.Contains("new");
    // Determine the matching shared stash file for this character
    string? monitorStashFile = null;
    try
    {
        var initBytes = File.ReadAllBytes(monitorFile);
        var initSave = D2Save.Read(initBytes);
        var charGameVersion = initSave.Character.Preview.GameVersion.ToString();
        var charCore = initSave.Character.Flags.HasFlag(CharacterFlags.Hardcore) ? "HardCore" : "SoftCore";
        var stashPrefix = charGameVersion == "ReignOfTheWarlock" ? "Modern" : "";
        var stashName = $"{stashPrefix}SharedStash{charCore}V2.d2i";
        var stashPath = Path.Combine(defaultSaveDir, stashName);
        if (File.Exists(stashPath))
        {
            monitorStashFile = stashPath;
            Console.WriteLine($"Also refreshing shared stash: {Path.GetFileName(monitorStashFile)}");
        }
    }
    catch (Exception ex)
    {
        Console.WriteLine($"Warning: could not read character for stash detection: {ex.Message}");
    }

    Console.WriteLine($"Monitoring {monitorFile} for new unique/set items every {monitorInterval}s (Ctrl+C to stop)...");

    var findScript = Path.Combine(Directory.GetCurrentDirectory(), "find_items.py");
    if (!File.Exists(findScript))
        findScript = Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "find_items.py");

    Dictionary<string, Item> previousItems = new();
    bool firstRun = true;

    while (true)
    {
        try
        {
            byte[] saveBytes = File.ReadAllBytes(monitorFile);
            D2Save save = D2Save.Read(saveBytes);

            var allItems = new List<Item>(save.Items);
            if (save.MercItems != null)
                foreach (var item in save.MercItems.Items)
                    allItems.Add(item);

            // Collect current unique/set items by name
            var currentItems = new Dictionary<string, Item>();
            foreach (var item in allItems)
            {
                if (item.Quality is ItemQuality.Unique or ItemQuality.Set
                    && item.Flags.HasFlag(ItemFlags.Identified))
                {
                    var name = GetItemDisplayName(item);
                    currentItems.TryAdd(name, item);
                }
            }

            if (!firstRun)
            {
                foreach (var (name, item) in currentItems)
                {
                    if (!previousItems.ContainsKey(name))
                    {
                        var timestamp = DateTime.Now.ToString("HH:mm:ss");
                        var statRanges = GetStatRangesForItem(item);
                        var score = CalculatePerfectionScore(item, statRanges);
                        var scoreStr = score.HasValue ? $" - (Perfection: {score:F2}%)" : " - (No Perfection Score)";
                        var ethStr = item.Flags.HasFlag(ItemFlags.Ethereal) ? " [ETH]" : "";
                        if (beepOnFound) Console.Beep();
                        Console.WriteLine($"\n------\n");
                        Console.WriteLine($"[{timestamp}] NEW ITEM DETECTED: {name}{ethStr}{scoreStr}");
                        if (score.HasValue) {

                            // Print stats with ranges
                            if (item.Defense.HasValue)
                            {
                                var baseRange = GetBaseDefenseRange(item.ItemCodeString);
                                if (baseRange != null)
                                    Console.WriteLine($"  Defense: {item.Defense} (base: {baseRange})");
                                else
                                    Console.WriteLine($"  Defense: {item.Defense}");
                            }
                            var allMonStats = new List<Stat>();
                            if (item.RunewordStats != null) allMonStats.AddRange(item.RunewordStats);
                            if (item.Stats != null) allMonStats.AddRange(item.Stats);
                            foreach (var stat in allMonStats)
                            {
                                var text = FormatStat(stat);
                                if (statRanges != null && statRanges.TryGetValue(((int)stat.Id, stat.Layer), out var range) && range.Min != range.Max)
                                    Console.WriteLine($"  {text} [{range.Min}-{range.Max}]");
                                else
                                    Console.WriteLine($"  {text}");
                            }
                        } 

                        // Refresh shared stash JSON before searching
                        if (monitorStashFile != null)
                        {
                            try
                            {
                                var stashBytes = File.ReadAllBytes(monitorStashFile);
                                ProcessSharedStash(monitorStashFile, stashBytes);
                            }
                            catch { }
                        }

                        // Find existing copies across all saves
                        var existing = FindExistingItems(name, findScript);
                        bool isBest = false;
                        if (existing.Count == 0)
                        {
                            Console.WriteLine($"************** This is your first one! ***************");
                            isBest = true;
                            if (beepOnNew) Console.Beep();
                        } else
                        {
                            Console.WriteLine($"  You already have {existing.Count} of this item.");
                            isBest = true;
                            foreach (var copy in existing)
                            {
                                var charName = copy.TryGetProperty("character", out var cn) ? cn.GetString() : "?";
                                bool copyEthereal = false;
                                if (copy.TryGetProperty("flags", out var fl))
                                    foreach (var f in fl.EnumerateArray())
                                        if (f.GetString() == "Ethereal") { copyEthereal = true; break; }
                                var copyEthStr = copyEthereal ? " [ETH]" : "";
                                if (copy.TryGetProperty("perfectionScore", out var ps))
                                {
                                    var copyScore = ps.GetDouble();
                                    var scoreVal = score!.Value;
                                    var comparison = scoreVal > copyScore ? "THE NEW ONE IS BETTER"
                                        : scoreVal < copyScore ? "the new one is worse"
                                        : "same score";
                                    Console.WriteLine($"    Copy on {charName}{copyEthStr} scored {copyScore:F2}%. {comparison}.");
                                    if (copyScore >= scoreVal)
                                        isBest = false;
                                }
                                else
                                {
                                    Console.WriteLine($"    Copy on [{charName}]{copyEthStr}");
                                }

                                if (score.HasValue) {
                                    // Print stats of existing copy
                                    foreach (var statList in new[] { "runewordStats", "stats" })
                                    {
                                        if (copy.TryGetProperty(statList, out var stats))
                                        {
                                            foreach (var s in stats.EnumerateArray())
                                            {
                                                var desc = s.TryGetProperty("description", out var d) ? d.GetString() : "?";
                                                var rangeStr = s.TryGetProperty("range", out var r) ? $" [{r.GetString()}]" : "";
                                                Console.WriteLine($"      {desc}{rangeStr}");
                                            }
                                        }
                                    }
                                }

                            }
                            if (score.HasValue && isBest)
                            {
                                Console.WriteLine($"************** This is the best one! ***************");
                                if (beepOnBest) Console.Beep();
                            }
                        }
                    }
                }
            }
            else
            {
                Console.WriteLine($"Loaded {currentItems.Count} unique/set items. Watching for changes...");
                firstRun = false;
            }

            previousItems = currentItems;
        }
        catch (Exception ex)
        {
            // File might be locked during save, just skip this cycle
            Console.WriteLine($"  (read error, retrying: {ex.Message})");
        }

        Thread.Sleep(monitorInterval * 1000);
    }
}

void ProcessCharacterSave(string saveFile, byte[] saveBytes)
{
    D2Save save = D2Save.Read(saveBytes, externalData);

    // Group items by location
    var equipped = new List<Item>();
    var inventory = new List<Item>();
    var stash = new List<Item>();
    var cube = new List<Item>();
    var belt = new List<Item>();

    foreach (var item in save.Items)
    {
        if (item.Position.Mode == ItemMode.Equipped)
            equipped.Add(item);
        else if (item.Position.Mode == ItemMode.InBelt)
            belt.Add(item);
        else if (item.Position.StorePage == StorePage.Inventory)
            inventory.Add(item);
        else if (item.Position.StorePage == StorePage.Stash)
            stash.Add(item);
        else if (item.Position.StorePage == StorePage.Cube)
            cube.Add(item);
        else
            inventory.Add(item);
    }

    var merc = new List<Item>();
    if (save.MercItems != null)
    {
        foreach (var item in save.MercItems.Items)
            merc.Add(item);
    }

    // ── Write JSON output ──

    var jsonData = new Dictionary<string, object>
    {
        ["file"] = Path.GetFileName(saveFile),
        ["character"] = new Dictionary<string, object>
        {
            ["name"] = save.Character.Preview.Name,
            ["level"] = save.Character.Level,
            ["class"] = save.Character.Class.ToString(),
            ["gameVersion"] = save.Character.Preview.GameVersion.ToString(),
            ["core"] = save.Character.Flags.HasFlag(CharacterFlags.Hardcore) ? "hard" : "soft"
        },
        ["stats"] = BuildCharStatsJson(save),
        ["items"] = equipped.Concat(belt).Concat(inventory).Concat(stash).Concat(cube).Concat(merc)
            .Select(BuildItemJson).ToList()
    };

    var jsonPath = Path.ChangeExtension(saveFile, ".json");
    File.WriteAllText(jsonPath, JsonSerializer.Serialize(jsonData, jsonOptions));
    // Console.WriteLine($"  JSON written to {jsonPath}");
}

void ProcessSharedStash(string saveFile, byte[] saveBytes)
{
    D2StashSave stashSave = D2StashSave.Read(saveBytes, externalData);

    // Collect items per tab
    var tabItems = new List<(string TabName, uint Gold, List<Item> Items)>();
    for (int t = 0; t < stashSave.Count; t++)
    {
        var tab = stashSave[t];
        if (tab.TabType == StashTabType.Chronicle) continue;
        var items = new List<Item>();
        foreach (var item in tab.Items)
            items.Add(item);
        tabItems.Add(($"Shared Stash Tab {t + 1}", tab.Gold, items));
    }

    // ── Write JSON output ──

    // Determine core and gameVersion from filename
    var fileName = Path.GetFileNameWithoutExtension(saveFile);
    var core = fileName.Contains("HardCore", StringComparison.OrdinalIgnoreCase) ? "hard" : "soft";
    var gameVersion = fileName.StartsWith("Modern", StringComparison.OrdinalIgnoreCase)
        ? "ReignOfTheWarlock" : "Expansion";

    var allItems = tabItems.SelectMany(t => t.Items).Select(BuildItemJson).ToList();
    var jsonData = new Dictionary<string, object>
    {
        ["file"] = Path.GetFileName(saveFile),
        ["type"] = "SharedStash",
        ["core"] = core,
        ["gameVersion"] = gameVersion,
        ["tabs"] = tabItems.Select(t => new Dictionary<string, object>
        {
            ["name"] = t.TabName,
            ["gold"] = t.Gold,
            ["itemCount"] = t.Items.Count
        }).ToList(),
        ["items"] = allItems
    };

    var jsonPath = Path.ChangeExtension(saveFile, ".json");
    File.WriteAllText(jsonPath, JsonSerializer.Serialize(jsonData, jsonOptions));
    // Console.WriteLine($"  JSON written to {jsonPath}");
}


Dictionary<string, long> BuildCharStatsJson(D2Save save)
{
    var stats = new Dictionary<string, long>();
    void Add(string label, StatId id)
    {
        var val = save.Stats.GetStat(id);
        if (val != 0)
            stats[label] = (id is StatId.MaxLife or StatId.MaxMana or StatId.MaxStamina) ? val >> 8 : val;
    }
    Add("strength", StatId.Strength);
    Add("dexterity", StatId.Dexterity);
    Add("vitality", StatId.Vitality);
    Add("energy", StatId.Energy);
    Add("life", StatId.MaxLife);
    Add("mana", StatId.MaxMana);
    Add("stamina", StatId.MaxStamina);
    Add("gold", StatId.Gold);
    Add("stashGold", StatId.StashGold);
    return stats;
}

// ── Helper methods ──

Dictionary<(int StatId, int Layer), (int Min, int Max)>? GetStatRangesForItem(Item item)
{
    if (item.Quality == ItemQuality.Unique && item.QualityData is SetUniqueQualityData uqd)
    {
        uniqueStatRanges.TryGetValue(uqd.SetUniqueFileIndex, out var ranges);
        return ranges;
    }
    if (item.Quality == ItemQuality.Set && item.QualityData is SetUniqueQualityData sqd)
    {
        setStatRanges.TryGetValue(sqd.SetUniqueFileIndex, out var ranges);
        return ranges;
    }
    if (item.Flags.HasFlag(ItemFlags.Runeword))
    {
        var runeKey = string.Join(",", item.Sockets
            .Where(s => s != null)
            .Select(s => s!.ItemCodeString.TrimEnd('\0').Trim()));
        runewordStatRanges.TryGetValue(runeKey, out var ranges);
        return ranges;
    }
    return null;
}

double? CalculatePerfectionScore(Item item, Dictionary<(int StatId, int Layer), (int Min, int Max)>? ranges)
{
    if (ranges == null) return null;

    double totalPercent = 0;
    int rangedCount = 0;

    var allStats = new List<Stat>();
    if (item.Stats != null) allStats.AddRange(item.Stats);
    if (item.RunewordStats != null) allStats.AddRange(item.RunewordStats);

    foreach (var stat in allStats)
    {
        if (stat.Id == StatId.ItemChargedSkill) continue;
        var key = ((int)stat.Id, stat.Layer);
        if (!ranges.TryGetValue(key, out var range)) continue;
        if (range.Min == range.Max) continue;

        var value = stat.Value;
        if (stat.Id is StatId.MaxLife or StatId.MaxMana or StatId.MaxStamina)
            value >>= 8;

        double pct = (double)(value - range.Min) / (range.Max - range.Min) * 100.0;
        pct = Math.Clamp(pct, 0, 100);
        totalPercent += pct;
        rangedCount++;
    }

    // Include base defense in the score for armor items
    // Enhanced defense is scored separately via the ArmorPercent stat in the loop above
    // We cannot reliably back-calculate the base defense roll from the final defense value
    // because superior quality and ethereal bonuses interact in complex ways.
    // Instead, we skip defense from the perfection score and rely on the ED stat range alone.

    if (rangedCount == 0) return null;
    return Math.Round(totalPercent / rangedCount, 2);
}

Dictionary<string, object?> BuildItemJson(Item item)
{
    var tier = GetItemTier(item.ItemCodeString);
    var type = GetItemType(item.ItemCodeString);
    var setName = GetSetName(item);
    var statRanges = GetStatRangesForItem(item);
    var score = CalculatePerfectionScore(item, statRanges);
    var obj = new Dictionary<string, object?>
    {
        ["name"] = GetItemDisplayName(item),
        ["baseName"] = GetItemName(item.ItemCodeString),
        ["itemCode"] = item.ItemCodeString.TrimEnd('\0').Trim(),
        ["itemLevel"] = item.ItemLevel,
        ["type"] = type,
        ["tier"] = tier,
        ["quality"] = item.Quality.ToString(),
        ["set"] = setName,
        ["baseDefenseRange"] = GetBaseDefenseRange(item.ItemCodeString),
        ["defenseRange"] = statRanges != null && GetEffectiveDefenseRange(item, statRanges) is (int dMin, int dMax) ? $"{dMin}-{dMax}" : null,
        ["location"] = GetLocationString(item)
    };

    if (score.HasValue)
        obj["perfectionScore"] = score.Value;

    // Flags
    var flags = new List<string>();
    if (item.Flags.HasFlag(ItemFlags.Ethereal)) flags.Add("Ethereal");
    if (item.Flags.HasFlag(ItemFlags.Runeword)) flags.Add("Runeword");
    if (item.Flags.HasFlag(ItemFlags.Socketed)) flags.Add($"Socketed ({item.Sockets.Count})");
    if (!item.Flags.HasFlag(ItemFlags.Identified)) flags.Add("Unidentified");
    if (item.Flags.HasFlag(ItemFlags.Personalized)) flags.Add("Personalized");
    if (flags.Count > 0)
        obj["flags"] = flags;

    if (item.Defense.HasValue)
        obj["defense"] = item.Defense.Value;
    if (item.MaxDurability.HasValue && item.MaxDurability > 0)
    {
        obj["durability"] = item.Durability;
        obj["maxDurability"] = item.MaxDurability.Value;
    }
    if (item.Quantity.HasValue)
        obj["quantity"] = item.Quantity.Value;

    if (item.RunewordStats?.Count > 0)
        obj["runewordStats"] = item.RunewordStats.Select(s => FormatStatJson(s, statRanges)).ToList();

    if (item.Stats?.Count > 0)
        obj["stats"] = item.Stats.Select(s => FormatStatJson(s, statRanges)).ToList();

    for (int i = 0; i < (item.SetBonusStats?.Count ?? 0); i++)
    {
        if (item.SetBonusStats![i] != null && item.SetBonusStats[i].Count > 0)
        {
            obj[$"setBonus{i + 1}"] = item.SetBonusStats[i].Select(s => FormatStatJson(s, null)).ToList();
        }
    }

    var socketStatLines = GetSocketStats(item);
    if (socketStatLines.Count > 0)
        obj["socketBonuses"] = socketStatLines;

    if (item.Sockets.Count > 0)
    {
        obj["socketCount"] = item.Sockets.Count;
        obj["openSockets"] = item.Sockets.Count - item.Sockets.Count(s => s != null);
        obj["sockets"] = item.Sockets
            .Where(s => s != null)
            .Select(s => new Dictionary<string, object>
            {
                ["code"] = s!.ItemCodeString.TrimEnd('\0').Trim(),
                ["name"] = GetItemName(s.ItemCodeString)
            })
            .ToList();
    }

    return obj;
}

Dictionary<string, object> FormatStatJson(Stat stat, Dictionary<(int StatId, int Layer), (int Min, int Max)>? ranges)
{
    var obj = new Dictionary<string, object>
    {
        ["id"] = stat.Id.ToString(),
        ["description"] = FormatStat(stat)
    };

    var value = stat.Value;
    if (stat.Id is StatId.MaxLife or StatId.MaxMana or StatId.MaxStamina)
        value >>= 8;
    obj["value"] = value;

    if (stat.Layer != 0)
        obj["layer"] = stat.Layer;

    if (ranges != null && ranges.TryGetValue(((int)stat.Id, stat.Layer), out var range) && range.Min != range.Max)
        obj["range"] = $"{range.Min}-{range.Max}";

    return obj;
}

string GetItemDisplayName(Item item)
{
    var baseName = GetItemName(item.ItemCodeString);

    if (item.Flags.HasFlag(ItemFlags.Runeword))
    {
        var rwName = GetRunewordNameFromSockets(item);
        return $"{rwName} ({baseName})";
    }

    if (item.Quality == ItemQuality.Unique && item.QualityData is SetUniqueQualityData uqd)
    {
        if (uniqueItemNames.TryGetValue(uqd.SetUniqueFileIndex, out var uName))
            return $"{uName} ({baseName})";
    }

    if (item.Quality == ItemQuality.Set && item.QualityData is SetUniqueQualityData sqd)
    {
        if (setItemNames.TryGetValue(sqd.SetUniqueFileIndex, out var sName))
            return $"{sName} ({baseName})";
    }

    return item.Quality switch
    {
        ItemQuality.Inferior => $"Crude {baseName}",
        ItemQuality.Superior => $"Superior {baseName}",
        ItemQuality.Unique => $"[Unique] {baseName}",
        ItemQuality.Set => $"[Set] {baseName}",
        ItemQuality.Rare => $"[Rare] {baseName}",
        ItemQuality.Craft => $"[Crafted] {baseName}",
        ItemQuality.Tempered => $"[Tempered] {baseName}",
        _ => baseName
    };
}

string GetRunewordNameFromSockets(Item item)
{
    var runeKey = string.Join(",", item.Sockets
        .Where(s => s != null)
        .Select(s => s!.ItemCodeString.TrimEnd('\0').Trim()));

    if (runewordsByRunes.TryGetValue(runeKey, out var rwName))
        return rwName;

    return "Unknown Runeword";
}

string GetLocationString(Item item)
{
    if (item.Position.Mode == ItemMode.Equipped)
        return item.Position.BodyLocation.ToString();
    if (item.Position.Mode == ItemMode.InBelt)
        return "Belt";
    if (item.Position.Mode == ItemMode.Stored)
        return item.Position.StorePage.ToString();
    return item.Position.Mode.ToString();
}

string GetItemName(string code)
{
    var trimmed = code.TrimEnd('\0').Trim();
    if (itemNames.TryGetValue(trimmed, out var name))
        return name;
    return trimmed;
}

string? GetItemTier(string code)
{
    var trimmed = code.TrimEnd('\0').Trim();
    if (itemTiers.TryGetValue(trimmed, out var tier))
        return tier;
    return null;
}

string? GetItemType(string code)
{
    var trimmed = code.TrimEnd('\0').Trim();
    if (itemTypes.TryGetValue(trimmed, out var type))
        return type;
    return null;
}

string? GetBaseDefenseRange(string code)
{
    var trimmed = code.TrimEnd('\0').Trim();
    if (itemDefenseRanges.TryGetValue(trimmed, out var range))
        return range;
    return null;
}

(int Min, int Max)? GetEffectiveDefenseRange(Item item, Dictionary<(int StatId, int Layer), (int Min, int Max)>? statRanges)
{
    var baseRangeStr = GetBaseDefenseRange(item.ItemCodeString);
    if (baseRangeStr == null) return null;
    var parts = baseRangeStr.Split('-');
    if (parts.Length != 2 || !int.TryParse(parts[0], out var baseMin) || !int.TryParse(parts[1], out var baseMax))
        return null;

    // Look up enhanced defense (ArmorPercent, StatId=16) range from the item's stat ranges
    int edMin = 0, edMax = 0;
    if (statRanges != null && statRanges.TryGetValue((16, 0), out var edRange))
    {
        edMin = edRange.Min;
        edMax = edRange.Max;
    }

    int effMin = (int)(baseMin * (1 + edMin / 100.0));
    int effMax = (int)(baseMax * (1 + edMax / 100.0));
    return (effMin, effMax);
}

string? GetSetName(Item item)
{
    if (item.Quality == ItemQuality.Set && item.QualityData is SetUniqueQualityData sqd)
    {
        if (setItemSetNames.TryGetValue(sqd.SetUniqueFileIndex, out var setName))
            return setName;
    }
    return null;
}

string FormatStat(Stat stat)
{
    var name = FormatStatName(stat.Id);
    var value = stat.Value;

    if (stat.Id is StatId.MaxLife or StatId.MaxMana or StatId.MaxStamina)
        value >>= 8;

    if (IsPerLevelStat(stat.Id))
    {
        var desc = GetPerLevelDescription(stat.Id);
        return $"+{value / 8.0:0.###} {desc} (per level)";
    }

    if (IsSkillStat(stat.Id) && (stat.Layer != 0
        || stat.Id == StatId.AddClassSkills || stat.Id == StatId.AddSkillTab))
    {
        var skillName = GetSkillName(stat.Id, stat.Layer);
        return $"+{value} to {skillName}";
    }

    if (IsPercentStat(stat.Id))
        return $"{name}: {(value >= 0 ? "+" : "")}{value}%";

    if (IsSignedStat(stat.Id))
        return $"{name}: {(value >= 0 ? "+" : "")}{value}";

    return $"{name}: {value}";
}

string FormatStatName(StatId id)
{
    var name = id.ToString();
    return Regex.Replace(name, "([a-z])([A-Z])", "$1 $2");
}

bool IsPerLevelStat(StatId id) => id is
    StatId.StrengthPerLevel or StatId.DexterityPerLevel or StatId.VitalityPerLevel or
    StatId.EnergyPerLevel or StatId.LifePerLevel or StatId.ManaPerLevel or
    StatId.ArmorPerLevel or StatId.MagicFindPerLevel or StatId.FindGoldPerLevel or
    StatId.AttackRatingPerLevel or StatId.MaxDamagePerLevel or StatId.MaxDamagePercentPerLevel;

string GetPerLevelDescription(StatId id) => id switch
{
    StatId.StrengthPerLevel => "Strength",
    StatId.DexterityPerLevel => "Dexterity",
    StatId.VitalityPerLevel => "Vitality",
    StatId.EnergyPerLevel => "Energy",
    StatId.LifePerLevel => "Life",
    StatId.ManaPerLevel => "Mana",
    StatId.ArmorPerLevel => "Defense",
    StatId.MagicFindPerLevel => "Magic Find%",
    StatId.FindGoldPerLevel => "Gold Find%",
    StatId.AttackRatingPerLevel => "Attack Rating",
    StatId.MaxDamagePerLevel => "Max Damage",
    StatId.MaxDamagePercentPerLevel => "Max Damage%",
    _ => id.ToString()
};

bool IsSkillStat(StatId id) => id is
    StatId.NonClassSkill or StatId.SingleSkill or StatId.AddSkillTab or
    StatId.AddClassSkills;

string GetSkillName(StatId statType, int id)
{
    if (statType == StatId.AddSkillTab)
    {
        // Skill tabs are class_index * 8 + tab_offset (0-2)
        // Tab names are hardcoded per class since they come from string tables
        return id switch
        {
            0 => "Amazon Bow & Crossbow Skills",
            1 => "Amazon Passive & Magic Skills",
            2 => "Amazon Javelin & Spear Skills",
            8 => "Sorceress Fire Skills",
            9 => "Sorceress Lightning Skills",
            10 => "Sorceress Cold Skills",
            16 => "Necromancer Curses",
            17 => "Necromancer Poison & Bone Skills",
            18 => "Necromancer Summoning Skills",
            24 => "Paladin Combat Skills",
            25 => "Paladin Offensive Auras",
            26 => "Paladin Defensive Auras",
            32 => "Barbarian Combat Skills",
            33 => "Barbarian Masteries",
            34 => "Barbarian Warcries",
            40 => "Druid Summoning Skills",
            41 => "Druid Shape Shifting Skills",
            42 => "Druid Elemental Skills",
            48 => "Assassin Traps",
            49 => "Assassin Shadow Disciplines",
            50 => "Assassin Martial Arts",
            56 => "Warlock Destruction Skills",
            57 => "Warlock Darkness Skills",
            58 => "Warlock Chaos Skills",
            _ => $"Skill Tab {id}"
        };
    }

    if (statType == StatId.AddClassSkills)
    {
        return id switch
        {
            0 => "Amazon Skills",
            1 => "Sorceress Skills",
            2 => "Necromancer Skills",
            3 => "Paladin Skills",
            4 => "Barbarian Skills",
            5 => "Druid Skills",
            6 => "Assassin Skills",
            7 => "Warlock Skills",
            _ => $"Class {id} Skills"
        };
    }

    // Look up individual skill names from skills.txt
    if (skillNames.TryGetValue(id, out var skillName))
        return skillName;
    return $"Skill #{id}";
}

bool IsSignedStat(StatId id) => id is
    StatId.Strength or StatId.Dexterity or StatId.Vitality or StatId.Energy or
    StatId.MaxLife or StatId.MaxMana or StatId.MaxStamina or
    StatId.ArmorClass or StatId.MinDamage or StatId.MaxDamage or
    StatId.FireMinDamage or StatId.FireMaxDamage or StatId.ColdMinDamage or StatId.ColdMaxDamage or
    StatId.LightningMinDamage or StatId.LightningMaxDamage or
    StatId.PoisonMinDamage or StatId.PoisonMaxDamage or
    StatId.MagicMinDamage or StatId.MagicMaxDamage or
    StatId.FireResist or StatId.ColdResist or StatId.LightningResist or StatId.PoisonResist or
    StatId.MagicResist or StatId.AllSkills or StatId.LightRadius or StatId.AttackRating or
    StatId.DefenseVsMissiles or StatId.HealAfterKill or
    StatId.AbsorbMagic or StatId.AbsorbFire or StatId.AbsorbLightning or StatId.AbsorbCold or
    StatId.HitPointRegeneration or StatId.ManaRecovery or
    StatId.NormalDamageReduction or StatId.MagicDamageReduction;

bool IsPercentStat(StatId id) => id is
    StatId.FasterRunWalk or StatId.FasterHitRecovery or StatId.FasterBlockRate or
    StatId.FasterCastRate or StatId.IncreasedAttackSpeed or
    StatId.MagicFind or StatId.GoldFind or
    StatId.CrushingBlow or StatId.OpenWounds or StatId.DeadlyStrike or
    StatId.MaxDamagePercent or StatId.MinDamagePercent or
    StatId.LifeSteal or StatId.ManaSteal or
    StatId.DamageReduced;

List<string> GetSocketStats(Item item)
{
    var lines = new List<string>();
    if (item.Sockets.Count == 0) return lines;

    // Determine gem apply type for the parent item (0=weapon, 1=helm/armor, 2=shield)
    var parentCode = item.ItemCodeString.TrimEnd('\0').Trim();
    int applyType = 1; // default to armor/helm
    if (gemApplyTypes.TryGetValue(parentCode, out var gat))
        applyType = gat;

    foreach (var socket in item.Sockets)
    {
        if (socket == null) continue;
        var socketCode = socket.ItemCodeString.TrimEnd('\0').Trim();

        // First, add any direct stats the socketed item has (jewels)
        if (socket.Stats?.Count > 0)
        {
            foreach (var stat in socket.Stats)
                lines.Add($"{FormatStat(stat)} ({GetItemName(socketCode)})");
        }

        // Then, look up gem/rune stats from gems.txt
        if (gemStats.TryGetValue(socketCode, out var mods))
        {
            var modSet = applyType switch
            {
                0 => mods.WeaponMods,
                2 => mods.ShieldMods,
                _ => mods.HelmMods
            };

            foreach (var mod in modSet)
            {
                var resolved = ResolvePropertyToText(mod.Code, mod.Param, mod.Min, mod.Max);
                if (resolved != null)
                    lines.Add($"{resolved} ({GetItemName(socketCode)})");
            }
        }
    }

    return lines;
}

string? ResolvePropertyToText(string propCode, string param, int min, int max)
{
    if (string.IsNullOrEmpty(propCode)) return null;

    if (!propertyToStats.TryGetValue(propCode, out var propEntries))
        return $"{propCode}: {min}-{max}";

    var parts = new List<string>();
    foreach (var entry in propEntries)
    {
        var statId = -1;
        if (!string.IsNullOrEmpty(entry.Stat) && statNameToId.TryGetValue(entry.Stat, out var sid))
            statId = sid;

        var value = (min == max) ? $"{min}" : $"{min}-{max}";

        // func determines how the property applies
        switch (entry.Func)
        {
            case 1: // direct stat assignment
            case 3: // same as 1 for our purposes
            case 8: // same as 1, speed-type stats
                if (statId >= 0)
                {
                    var id = (StatId)statId;
                    var name = FormatStatName(id);
                    if (IsPercentStat(id))
                        parts.Add($"{name}: +{value}%");
                    else if (IsSignedStat(id))
                        parts.Add($"{name}: +{value}");
                    else
                        parts.Add($"{name}: {value}");
                }
                else
                    parts.Add($"{propCode}: {value}");
                break;
            case 5: // min damage (mindamage stat)
                parts.Add($"Min Damage: +{value}");
                break;
            case 6: // max damage (maxdamage stat)
                parts.Add($"Max Damage: +{value}");
                break;
            case 7: // dmg% - enhanced damage (min/max damage percent)
                parts.Add($"Enhanced Damage: +{value}%");
                break;
            case 10: // skilltab
                parts.Add($"+{value} to Skill Tab {param}");
                break;
            case 15: // min damage for elemental
                if (statId >= 0)
                    parts.Add($"{FormatStatName((StatId)statId)}: +{value}");
                break;
            case 16: // max damage for elemental
                if (statId >= 0)
                    parts.Add($"{FormatStatName((StatId)statId)}: +{value}");
                break;
            case 22: // skill (oskill/item_singleskill)
                var sName = skillNames.TryGetValue(int.TryParse(param, out var pid) ? pid : -1, out var sn) ? sn : $"Skill {param}";
                parts.Add($"+{value} to {sName}");
                break;
            default:
                if (statId >= 0)
                    parts.Add($"{FormatStatName((StatId)statId)}: {value}");
                else
                    parts.Add($"{propCode}: {value}");
                break;
        }
    }

    return parts.Count > 0 ? string.Join(", ", parts) : null;
}

// ── Data loading from game_files/default/excel ──

Dictionary<string, string> BuildItemNameLookup(string dir, Dictionary<string, string> stringTable)
{
    var lookup = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

    foreach (var file in new[] { "armor.txt", "weapons.txt", "misc.txt" })
    {
        var path = Path.Combine(dir, file);
        if (!File.Exists(path)) { Console.WriteLine($"Warning: game file not found: {path}"); missingFileCount++; continue; }

        var lines = File.ReadAllLines(path);
        if (lines.Length < 2) continue;

        var header = lines[0].Split('\t');
        int nameIdx = Array.IndexOf(header, "name");
        int codeIdx = Array.IndexOf(header, "code");
        if (nameIdx < 0 || codeIdx < 0) continue;

        for (int i = 1; i < lines.Length; i++)
        {
            var cols = lines[i].Split('\t');
            if (cols.Length > Math.Max(nameIdx, codeIdx))
            {
                var code = cols[codeIdx].Trim();
                var fallback = cols[nameIdx].Trim();
                // Base item names are keyed in item-names.json by the item code (e.g. "qf1", "xtp")
                var name = stringTable.TryGetValue(code, out var loc) ? loc : fallback;
                if (code.Length > 0 && name.Length > 0 && !lookup.ContainsKey(code))
                    lookup[code] = name;
            }
        }
    }

    return lookup;
}

Dictionary<int, string> BuildSkillNameLookup(string dir, Dictionary<string, string> stringTable)
{
    var lookup = new Dictionary<int, string>();
    var path = Path.Combine(dir, "skills.txt");
    if (!File.Exists(path)) { Console.WriteLine($"Warning: game file not found: {path}"); missingFileCount++; return lookup; }

    var lines = File.ReadAllLines(path);
    if (lines.Length < 2) return lookup;

    var header = lines[0].Split('\t');
    int nameIdx = Array.IndexOf(header, "skill");
    int idIdx = Array.IndexOf(header, "*Id");
    if (nameIdx < 0 || idIdx < 0) return lookup;

    for (int i = 1; i < lines.Length; i++)
    {
        var cols = lines[i].Split('\t');
        if (cols.Length > Math.Max(nameIdx, idIdx)
            && int.TryParse(cols[idIdx].Trim(), out var id))
        {
            var fallback = cols[nameIdx].Trim();
            // skills.json keys skills by "skillname<ID>"
            var name = stringTable.TryGetValue($"skillname{id}", out var loc) && loc.Trim().Length > 0
                ? loc.Trim() : fallback;
            if (name.Length > 0)
                lookup[id] = name;
        }
    }

    return lookup;
}

Dictionary<string, string> BuildStringTable(string dir)
{
    // Load localized string tables (Key -> enUS) for items, runes, and skills.
    // The strings dir lives at ../../local/lng/strings relative to the excel dir.
    var lookup = new Dictionary<string, string>(StringComparer.Ordinal);
    var stringsDir = Path.GetFullPath(Path.Combine(dir, "..", "..", "local", "lng", "strings"));
    foreach (var file in new[] { "item-names.json", "item-runes.json", "skills.json" })
    {
        var path = Path.Combine(stringsDir, file);
        if (!File.Exists(path)) continue;
        try
        {
            var doc = JsonDocument.Parse(File.ReadAllText(path));
            foreach (var entry in doc.RootElement.EnumerateArray())
            {
                if (!entry.TryGetProperty("Key", out var keyEl)) continue;
                if (!entry.TryGetProperty("enUS", out var enEl)) continue;
                var key = keyEl.GetString();
                var en = enEl.GetString();
                if (key != null && en != null && !lookup.ContainsKey(key))
                    lookup[key] = en;
            }
        }
        catch { /* skip on parse error */ }
    }
    return lookup;
}

Dictionary<string, string> BuildRunewordLookup(string dir, Dictionary<string, string> stringTable)
{
    // Maps "r31,r06,r30" -> "Enigma" (rune code combo -> runeword name)
    var lookup = new Dictionary<string, string>();
    var path = Path.Combine(dir, "runes.txt");
    if (!File.Exists(path)) { Console.WriteLine($"Warning: game file not found: {path}"); missingFileCount++; return lookup; }

    var lines = File.ReadAllLines(path);
    if (lines.Length < 2) return lookup;

    var header = lines[0].Split('\t');
    int keyIdx = Array.IndexOf(header, "Name");
    int nameIdx = Array.IndexOf(header, "*Rune Name");
    int completeIdx = Array.IndexOf(header, "complete");
    int rune1Idx = Array.IndexOf(header, "Rune1");
    if (nameIdx < 0 || rune1Idx < 0) return lookup;

    for (int i = 1; i < lines.Length; i++)
    {
        var cols = lines[i].Split('\t');
        if (cols.Length <= rune1Idx + 5) continue;

        // Only include complete runewords
        if (completeIdx >= 0 && cols[completeIdx].Trim() != "1") continue;

        var fallback = cols[nameIdx].Trim();
        var strKey = keyIdx >= 0 ? cols[keyIdx].Trim() : "";
        var name = (strKey.Length > 0 && stringTable.TryGetValue(strKey, out var loc)) ? loc : fallback;
        if (name.Length == 0) continue;

        var runes = new List<string>();
        for (int r = 0; r < 6; r++)
        {
            var rune = cols[rune1Idx + r].Trim();
            if (rune.Length > 0)
                runes.Add(rune);
        }

        if (runes.Count > 0)
        {
            var key = string.Join(",", runes);
            if (!lookup.ContainsKey(key))
                lookup[key] = name;
        }
    }

    return lookup;
}

Dictionary<int, string> BuildUniqueItemNameLookup(string dir, Dictionary<string, string> stringTable)
{
    return BuildIndexedNameLookup(Path.Combine(dir, "uniqueitems.txt"), stringTable);
}

Dictionary<int, string> BuildSetItemNameLookup(string dir, Dictionary<string, string> stringTable)
{
    return BuildIndexedNameLookup(Path.Combine(dir, "setitems.txt"), stringTable);
}

Dictionary<int, string> BuildIndexedNameLookup(string path, Dictionary<string, string> stringTable)
{
    var lookup = new Dictionary<int, string>();
    if (!File.Exists(path)) { Console.WriteLine($"Warning: game file not found: {path}"); missingFileCount++; return lookup; }

    var lines = File.ReadAllLines(path);
    if (lines.Length < 2) return lookup;

    var header = lines[0].Split('\t');
    int nameIdx = Array.IndexOf(header, "index");
    int idIdx = Array.IndexOf(header, "*ID");
    if (nameIdx < 0 || idIdx < 0) return lookup;

    for (int i = 1; i < lines.Length; i++)
    {
        var cols = lines[i].Split('\t');
        if (cols.Length > Math.Max(nameIdx, idIdx)
            && int.TryParse(cols[idIdx].Trim(), out var id))
        {
            var rawName = cols[nameIdx].Trim();
            var name = stringTable.TryGetValue(rawName, out var loc) ? loc : rawName;
            if (name.Length > 0)
                lookup[id] = name;
        }
    }

    return lookup;
}

// gemapplytype: 0=weapon, 1=armor/helm, 2=shield
Dictionary<string, int> BuildGemApplyTypeLookup(string dir)
{
    var lookup = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);

    foreach (var file in new[] { "armor.txt", "weapons.txt" })
    {
        var path = Path.Combine(dir, file);
        if (!File.Exists(path)) { Console.WriteLine($"Warning: game file not found: {path}"); missingFileCount++; continue; }

        var lines = File.ReadAllLines(path);
        if (lines.Length < 2) continue;

        var header = lines[0].Split('\t');
        int codeIdx = Array.IndexOf(header, "code");
        int gatIdx = Array.IndexOf(header, "gemapplytype");
        if (codeIdx < 0 || gatIdx < 0) continue;

        for (int i = 1; i < lines.Length; i++)
        {
            var cols = lines[i].Split('\t');
            if (cols.Length > Math.Max(codeIdx, gatIdx))
            {
                var code = cols[codeIdx].Trim();
                if (code.Length > 0 && int.TryParse(cols[gatIdx].Trim(), out var gat))
                    lookup[code] = gat;
            }
        }
    }

    return lookup;
}

Dictionary<string, GemModSet> BuildGemStatsLookup(string dir)
{
    var lookup = new Dictionary<string, GemModSet>(StringComparer.OrdinalIgnoreCase);
    var path = Path.Combine(dir, "gems.txt");
    if (!File.Exists(path)) { Console.WriteLine($"Warning: game file not found: {path}"); missingFileCount++; return lookup; }

    var lines = File.ReadAllLines(path);
    if (lines.Length < 2) return lookup;

    var header = lines[0].Split('\t');
    int codeIdx = Array.IndexOf(header, "code");
    int wStart = Array.IndexOf(header, "weaponMod1Code");
    int hStart = Array.IndexOf(header, "helmMod1Code");
    int sStart = Array.IndexOf(header, "shieldMod1Code");
    if (codeIdx < 0 || wStart < 0) return lookup;

    for (int i = 1; i < lines.Length; i++)
    {
        var cols = lines[i].Split('\t');
        if (cols.Length <= codeIdx) continue;
        var code = cols[codeIdx].Trim();
        if (code.Length == 0) continue;

        lookup[code] = new GemModSet(
            ParseGemMods(cols, wStart),
            ParseGemMods(cols, hStart),
            ParseGemMods(cols, sStart));
    }

    return lookup;
}

List<GemMod> ParseGemMods(string[] cols, int startIdx)
{
    var mods = new List<GemMod>();
    for (int m = 0; m < 3; m++)
    {
        int baseIdx = startIdx + m * 4;
        if (baseIdx + 3 >= cols.Length) break;
        var modCode = cols[baseIdx].Trim();
        if (modCode.Length == 0) continue;
        var param = cols[baseIdx + 1].Trim();
        int.TryParse(cols[baseIdx + 2].Trim(), out var min);
        int.TryParse(cols[baseIdx + 3].Trim(), out var max);
        mods.Add(new GemMod(modCode, param, min, max));
    }
    return mods;
}

Dictionary<string, List<PropertyEntry>> BuildPropertyToStatsLookup(string dir)
{
    var lookup = new Dictionary<string, List<PropertyEntry>>(StringComparer.OrdinalIgnoreCase);
    var path = Path.Combine(dir, "properties.txt");
    if (!File.Exists(path)) { Console.WriteLine($"Warning: game file not found: {path}"); missingFileCount++; return lookup; }

    var lines = File.ReadAllLines(path);
    if (lines.Length < 2) return lookup;

    var header = lines[0].Split('\t');
    int codeIdx = Array.IndexOf(header, "code");
    var funcIndices = new int[5];
    var statIndices = new int[5];
    for (int f = 0; f < 5; f++)
    {
        funcIndices[f] = Array.IndexOf(header, $"func{f + 1}");
        statIndices[f] = Array.IndexOf(header, $"stat{f + 1}");
    }

    for (int i = 1; i < lines.Length; i++)
    {
        var cols = lines[i].Split('\t');
        if (cols.Length <= codeIdx) continue;
        var code = cols[codeIdx].Trim();
        if (code.Length == 0) continue;

        var entries = new List<PropertyEntry>();
        for (int f = 0; f < 5; f++)
        {
            if (funcIndices[f] < 0 || funcIndices[f] >= cols.Length) continue;
            var funcStr = cols[funcIndices[f]].Trim();
            if (!int.TryParse(funcStr, out var func)) continue;
            var stat = (statIndices[f] >= 0 && statIndices[f] < cols.Length)
                ? cols[statIndices[f]].Trim() : "";
            entries.Add(new PropertyEntry(func, stat));
        }

        if (entries.Count > 0)
            lookup[code] = entries;
    }

    return lookup;
}

Dictionary<string, int> BuildStatNameToIdLookup(string dir)
{
    var lookup = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
    var path = Path.Combine(dir, "itemstatcost.txt");
    if (!File.Exists(path)) { Console.WriteLine($"Warning: game file not found: {path}"); missingFileCount++; return lookup; }

    var lines = File.ReadAllLines(path);
    if (lines.Length < 2) return lookup;

    var header = lines[0].Split('\t');
    int nameIdx = Array.IndexOf(header, "Stat");
    int idIdx = Array.IndexOf(header, "*ID");
    if (nameIdx < 0 || idIdx < 0) return lookup;

    for (int i = 1; i < lines.Length; i++)
    {
        var cols = lines[i].Split('\t');
        if (cols.Length > Math.Max(nameIdx, idIdx)
            && int.TryParse(cols[idIdx].Trim(), out var id))
        {
            var name = cols[nameIdx].Trim();
            if (name.Length > 0)
                lookup[name] = id;
        }
    }

    return lookup;
}

Dictionary<string, string> BuildItemTypeLookup(string dir)
{
    // First build type code -> type name from itemtypes.txt
    var typeNames = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
    var typesPath = Path.Combine(dir, "itemtypes.txt");
    if (File.Exists(typesPath))
    {
        var lines = File.ReadAllLines(typesPath);
        if (lines.Length >= 2)
        {
            var header = lines[0].Split('\t');
            int nameIdx = Array.IndexOf(header, "ItemType");
            int codeIdx = Array.IndexOf(header, "Code");
            if (nameIdx >= 0 && codeIdx >= 0)
            {
                for (int i = 1; i < lines.Length; i++)
                {
                    var cols = lines[i].Split('\t');
                    if (cols.Length > Math.Max(nameIdx, codeIdx))
                    {
                        var code = cols[codeIdx].Trim();
                        var name = cols[nameIdx].Trim();
                        if (code.Length > 0 && name.Length > 0 && !typeNames.ContainsKey(code))
                            typeNames[code] = name;
                    }
                }
            }
        }
    }
    else
    {
        Console.WriteLine($"Warning: game file not found: {typesPath}"); missingFileCount++;
    }

    // Then map item code -> type name via armor/weapons/misc type columns
    var lookup = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

    foreach (var file in new[] { "armor.txt", "weapons.txt", "misc.txt" })
    {
        var path = Path.Combine(dir, file);
        if (!File.Exists(path)) continue;

        var lines = File.ReadAllLines(path);
        if (lines.Length < 2) continue;

        var header = lines[0].Split('\t');
        int codeIdx = Array.IndexOf(header, "code");
        int typeIdx = Array.IndexOf(header, "type");
        if (codeIdx < 0 || typeIdx < 0) continue;

        for (int i = 1; i < lines.Length; i++)
        {
            var cols = lines[i].Split('\t');
            if (cols.Length > Math.Max(codeIdx, typeIdx))
            {
                var code = cols[codeIdx].Trim();
                var typeCode = cols[typeIdx].Trim();
                if (code.Length > 0 && typeCode.Length > 0 && !lookup.ContainsKey(code))
                {
                    if (typeNames.TryGetValue(typeCode, out var typeName))
                        lookup[code] = typeName;
                    else
                        lookup[code] = typeCode;
                }
            }
        }
    }

    return lookup;
}

Dictionary<int, string> BuildSetItemSetNameLookup(string dir)
{
    var lookup = new Dictionary<int, string>();
    var path = Path.Combine(dir, "setitems.txt");
    if (!File.Exists(path)) { Console.WriteLine($"Warning: game file not found: {path}"); missingFileCount++; return lookup; }

    var lines = File.ReadAllLines(path);
    if (lines.Length < 2) return lookup;

    var header = lines[0].Split('\t');
    int idIdx = Array.IndexOf(header, "*ID");
    int setIdx = Array.IndexOf(header, "set");
    if (idIdx < 0 || setIdx < 0) return lookup;

    for (int i = 1; i < lines.Length; i++)
    {
        var cols = lines[i].Split('\t');
        if (cols.Length > Math.Max(idIdx, setIdx)
            && int.TryParse(cols[idIdx].Trim(), out var id))
        {
            var setName = cols[setIdx].Trim();
            if (setName.Length > 0)
                lookup[id] = setName;
        }
    }

    return lookup;
}

Dictionary<string, string> BuildItemDefenseRangeLookup(string dir)
{
    var lookup = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
    var path = Path.Combine(dir, "armor.txt");
    if (!File.Exists(path)) { Console.WriteLine($"Warning: game file not found: {path}"); missingFileCount++; return lookup; }

    var lines = File.ReadAllLines(path);
    if (lines.Length < 2) return lookup;

    var header = lines[0].Split('\t');
    int codeIdx = Array.IndexOf(header, "code");
    int minIdx = Array.IndexOf(header, "minac");
    int maxIdx = Array.IndexOf(header, "maxac");
    if (codeIdx < 0 || minIdx < 0 || maxIdx < 0) return lookup;

    for (int i = 1; i < lines.Length; i++)
    {
        var cols = lines[i].Split('\t');
        if (cols.Length <= Math.Max(codeIdx, Math.Max(minIdx, maxIdx))) continue;
        var code = cols[codeIdx].Trim();
        if (code.Length == 0) continue;
        if (int.TryParse(cols[minIdx].Trim(), out var min) && int.TryParse(cols[maxIdx].Trim(), out var max) && max > 0)
            lookup[code] = $"{min}-{max}";
    }

    return lookup;
}

Dictionary<string, string> BuildItemTierLookup(string dir)
{
    var lookup = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

    foreach (var file in new[] { "armor.txt", "weapons.txt" })
    {
        var path = Path.Combine(dir, file);
        if (!File.Exists(path)) { Console.WriteLine($"Warning: game file not found: {path}"); missingFileCount++; continue; }

        var lines = File.ReadAllLines(path);
        if (lines.Length < 2) continue;

        var header = lines[0].Split('\t');
        int codeIdx = Array.IndexOf(header, "code");
        int normIdx = Array.IndexOf(header, "normcode");
        int uberIdx = Array.IndexOf(header, "ubercode");
        int ultraIdx = Array.IndexOf(header, "ultracode");
        if (codeIdx < 0) continue;

        for (int i = 1; i < lines.Length; i++)
        {
            var cols = lines[i].Split('\t');
            if (cols.Length <= codeIdx) continue;
            var code = cols[codeIdx].Trim();
            if (code.Length == 0) continue;

            var norm = normIdx >= 0 && normIdx < cols.Length ? cols[normIdx].Trim() : "";
            var uber = uberIdx >= 0 && uberIdx < cols.Length ? cols[uberIdx].Trim() : "";
            var ultra = ultraIdx >= 0 && ultraIdx < cols.Length ? cols[ultraIdx].Trim() : "";

            if (code == norm && !lookup.ContainsKey(code))
                lookup[code] = "Normal";
            else if (code == uber && !lookup.ContainsKey(code))
                lookup[code] = "Exceptional";
            else if (code == ultra && !lookup.ContainsKey(code))
                lookup[code] = "Elite";
        }
    }

    return lookup;
}

// Resolve a property code to its primary StatId using properties.txt and itemstatcost.txt
int ResolvePropertyToStatId(string propCode)
{
    if (string.IsNullOrEmpty(propCode)) return -1;
    if (!propertyToStats.TryGetValue(propCode, out var entries) || entries.Count == 0) return -1;
    var entry = entries[0];
    // Skip properties where min/max don't represent a value range
    // 11=gethit-skill, 19=charged, 12=skill-rand, 36=randclassskill
    // 15/16=elemental damage min/max (min=mindam, max=maxdam, not a roll range)
    // 17=per-level stats (param is the per-level value, not a range)
    if (entry.Func is 11 or 19 or 12 or 15 or 16 or 17 or 36) return -1;
    if (string.IsNullOrEmpty(entry.Stat)) return -1;
    if (statNameToId.TryGetValue(entry.Stat, out var id)) return id;
    return -1;
}

// Resolve a property param to a layer value (e.g., skill name -> skill ID)
int ResolveParamToLayer(string propCode, string param)
{
    if (string.IsNullOrEmpty(param)) return 0;
    // For skill-based properties (oskill, skill, skilltab, gethit-skill), param is a skill name
    if (!propertyToStats.TryGetValue(propCode, out var entries) || entries.Count == 0) return 0;
    var func = entries[0].Func;
    if (func is 10 or 22) // skilltab, oskill/skill
    {
        // Try to look up skill name -> skill ID
        if (int.TryParse(param, out var directId)) return directId;
        foreach (var kvp in skillNames)
        {
            if (kvp.Value.Equals(param, StringComparison.OrdinalIgnoreCase))
                return kvp.Key;
        }
    }
    if (int.TryParse(param, out var numParam)) return numParam;
    return 0;
}

Dictionary<(int StatId, int Layer), (int Min, int Max)> ParseStatRangesFromProps(string[] cols, int propStart, int propCount, int propStride)
{
    var ranges = new Dictionary<(int StatId, int Layer), (int Min, int Max)>();
    for (int p = 0; p < propCount; p++)
    {
        int baseIdx = propStart + p * propStride;
        if (baseIdx + 3 >= cols.Length) break;
        var propCode = cols[baseIdx].Trim();
        if (propCode.Length == 0) continue;
        var param = cols[baseIdx + 1].Trim();
        int.TryParse(cols[baseIdx + 2].Trim(), out var min);
        int.TryParse(cols[baseIdx + 3].Trim(), out var max);
        var statId = ResolvePropertyToStatId(propCode);
        if (statId < 0) continue;
        var layer = ResolveParamToLayer(propCode, param);
        var key = (statId, layer);
        if (!ranges.ContainsKey(key))
            ranges[key] = (min, max);
    }
    return ranges;
}

Dictionary<int, Dictionary<(int StatId, int Layer), (int Min, int Max)>> BuildUniqueStatRangesLookup(string dir)
{
    var lookup = new Dictionary<int, Dictionary<(int StatId, int Layer), (int Min, int Max)>>();
    var path = Path.Combine(dir, "uniqueitems.txt");
    if (!File.Exists(path)) return lookup;

    var lines = File.ReadAllLines(path);
    if (lines.Length < 2) return lookup;

    var header = lines[0].Split('\t');
    int idIdx = Array.IndexOf(header, "*ID");
    int propStart = Array.IndexOf(header, "prop1");
    if (idIdx < 0 || propStart < 0) return lookup;

    for (int i = 1; i < lines.Length; i++)
    {
        var cols = lines[i].Split('\t');
        if (cols.Length <= idIdx) continue;
        if (!int.TryParse(cols[idIdx].Trim(), out var id)) continue;
        var ranges = ParseStatRangesFromProps(cols, propStart, 12, 4);
        if (ranges.Count > 0)
            lookup[id] = ranges;
    }

    return lookup;
}

Dictionary<int, Dictionary<(int StatId, int Layer), (int Min, int Max)>> BuildSetStatRangesLookup(string dir)
{
    var lookup = new Dictionary<int, Dictionary<(int StatId, int Layer), (int Min, int Max)>>();
    var path = Path.Combine(dir, "setitems.txt");
    if (!File.Exists(path)) return lookup;

    var lines = File.ReadAllLines(path);
    if (lines.Length < 2) return lookup;

    var header = lines[0].Split('\t');
    int idIdx = Array.IndexOf(header, "*ID");
    int propStart = Array.IndexOf(header, "prop1");
    if (idIdx < 0 || propStart < 0) return lookup;

    for (int i = 1; i < lines.Length; i++)
    {
        var cols = lines[i].Split('\t');
        if (cols.Length <= idIdx) continue;
        if (!int.TryParse(cols[idIdx].Trim(), out var id)) continue;
        var ranges = ParseStatRangesFromProps(cols, propStart, 9, 4);
        if (ranges.Count > 0)
            lookup[id] = ranges;
    }

    return lookup;
}

Dictionary<string, Dictionary<(int StatId, int Layer), (int Min, int Max)>> BuildRunewordStatRangesLookup(string dir)
{
    // Keyed by rune combo string like "r31,r06,r30"
    var lookup = new Dictionary<string, Dictionary<(int StatId, int Layer), (int Min, int Max)>>();
    var path = Path.Combine(dir, "runes.txt");
    if (!File.Exists(path)) return lookup;

    var lines = File.ReadAllLines(path);
    if (lines.Length < 2) return lookup;

    var header = lines[0].Split('\t');
    int completeIdx = Array.IndexOf(header, "complete");
    int rune1Idx = Array.IndexOf(header, "Rune1");
    int propStart = Array.IndexOf(header, "T1Code1");
    if (rune1Idx < 0 || propStart < 0) return lookup;

    for (int i = 1; i < lines.Length; i++)
    {
        var cols = lines[i].Split('\t');
        if (cols.Length <= propStart) continue;
        if (completeIdx >= 0 && cols[completeIdx].Trim() != "1") continue;

        var runes = new List<string>();
        for (int r = 0; r < 6; r++)
        {
            var rune = cols[rune1Idx + r].Trim();
            if (rune.Length > 0) runes.Add(rune);
        }
        if (runes.Count == 0) continue;
        var key = string.Join(",", runes);

        var ranges = ParseStatRangesFromProps(cols, propStart, 7, 4);
        if (ranges.Count > 0 && !lookup.ContainsKey(key))
            lookup[key] = ranges;
    }

    return lookup;
}

Dictionary<string, string> LoadConfig(string filename)
{
    var config = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

    // Look for config file next to the executable, then in the current directory
    var candidates = new[]
    {
        Path.Combine(AppContext.BaseDirectory, filename),
        Path.Combine(Directory.GetCurrentDirectory(), filename)
    };

    foreach (var path in candidates)
    {
        if (!File.Exists(path)) continue;
        foreach (var line in File.ReadAllLines(path))
        {
            var trimmed = line.Trim();
            if (trimmed.Length == 0 || trimmed.StartsWith('#')) continue;
            var eqIdx = trimmed.IndexOf('=');
            if (eqIdx <= 0) continue;
            var key = trimmed[..eqIdx].Trim();
            var value = trimmed[(eqIdx + 1)..].Trim();
            if (key.Length > 0 && value.Length > 0)
            {
                if (value.StartsWith("~"))
                    value = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile) + value[1..];
                config[key] = value;
            }
        }
        break; // use the first config file found
    }

    return config;
}

// Record types must come after all top-level statements
record GemMod(string Code, string Param, int Min, int Max);
record GemModSet(List<GemMod> WeaponMods, List<GemMod> HelmMods, List<GemMod> ShieldMods);
record PropertyEntry(int Func, string Stat);
