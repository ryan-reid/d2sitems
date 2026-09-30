using D2SItems;
using D2SSharp.Data;
using D2SSharp.Model;
using D2SSharp.Enums;
using System.Diagnostics;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

try { D2SItems.SaveFileTransaction.RecoverPending(); }
catch (Exception ex)
{
    Console.Error.WriteLine(ex.Message);
    Environment.ExitCode = 1;
    return;
}

// Load config file (looks next to the executable, then in the current directory)
var config = LoadConfig("d2sitems.conf");

var excelDir = config.GetValueOrDefault("excel_dir",
    @"C:\Program Files (x86)\Diablo II Resurrected\data\global\excel");
var defaultSaveDir = config.GetValueOrDefault("save_dir",
    Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
        "Saved Games", "Diablo II Resurrected"));

var filteredArgs = new List<string>();
for (int i = 0; i < args.Length; i++)
{
    if (args[i] == "--excel" && i + 1 < args.Length)
    {
        excelDir = args[++i];
    }
    else
    {
        filteredArgs.Add(args[i]);
    }
}
args = filteredArgs.ToArray();

// Check for create-mule mode
if (args.Length >= 1 && (args[0] == "create-mule" || args[0] == "--create-mule"))
{
    Environment.ExitCode = D2SItems.MuleGenerator.Run(args, defaultSaveDir, excelDir);
    return;
}

// Check for complete-quests mode
if (args.Length >= 1 && (args[0] == "complete-quests" || args[0] == "--complete-quests"))
{
    int exitCode = D2SItems.QuestManager.RunCli(args, defaultSaveDir, excelDir);
    Environment.Exit(exitCode);
    return;
}

// Check for item transfer / fill-mule mode
if (args.Length >= 1 && (args[0] == "transfer-item" || args[0] == "--transfer-item" || args[0] == "fill-mule" || args[0] == "--fill-mule"))
{
    int exitCode = D2SItems.ItemTransferManager.RunCli(args, defaultSaveDir, excelDir);
    Environment.Exit(exitCode);
    return;
}

// Check for edit-stack mode
if (args.Length >= 1 && (args[0] == "edit-stack" || args[0] == "--edit-stack"))
{
    int exitCode = D2SItems.StackEditorManager.RunCli(args, defaultSaveDir, excelDir);
    Environment.Exit(exitCode);
    return;
}



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
var itemNames = GameDataTables.BuildItemNameLookup(excelDir, stringTable);
var (skillNames, skillNameToId) = GameDataTables.BuildSkillLookups(excelDir, stringTable);
var runewordsByRunes = GameDataTables.BuildRunewordLookup(excelDir, stringTable);
var uniqueItemNames = GameDataTables.BuildUniqueItemNameLookup(excelDir, stringTable);
var setItemNames = GameDataTables.BuildSetItemNameLookup(excelDir, stringTable);
var gemApplyTypes = GameDataTables.BuildGemApplyTypeLookup(excelDir);
var gemStats = GameDataTables.BuildGemStatsLookup(excelDir);
var catalogRevision = GameDataTables.Revision(excelDir);
var propertyToStats = GameDataTables.BuildPropertyToStatsLookup(excelDir);
var statNameToId = GameDataTables.BuildStatNameToIdLookup(excelDir);
var statCostLookup = GameDataTables.BuildStatCostLookup(excelDir);
var itemTiers = GameDataTables.BuildItemTierLookup(excelDir);
var itemTypes = GameDataTables.BuildItemTypeLookup(excelDir);
var setItemSetNames = GameDataTables.BuildSetItemSetNameLookup(excelDir, stringTable);
var itemDefenseRanges = GameDataTables.BuildItemDefenseRangeLookup(excelDir);
var questItemCodes = GameDataTables.BuildQuestItemCodes(excelDir);
var excludedItemNames = config.GetValueOrDefault("exclude_items", "")
    .Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries)
    .ToHashSet(StringComparer.OrdinalIgnoreCase);
var rangeCatalog = new D2SItems.PropertyRangeCatalog(propertyToStats, statNameToId, skillNameToId);
var uniqueStatRanges = rangeCatalog.BuildUniqueStatRangesLookup(excelDir);
var setStatRanges = rangeCatalog.BuildSetStatRangesLookup(excelDir);
var runewordStatRanges = rangeCatalog.BuildRunewordStatRangesLookup(excelDir);
var itemDimensions = D2SItems.ItemDimensionsLookup.LoadFromExcel(excelDir);

// Set up external data cache for D2SSharp to use the configured excel files
var externalDataCache = new Dictionary<int, IExternalData>();
IExternalData GetExternalData(int version)
{
    if (externalDataCache.TryGetValue(version, out var cached))
        return cached;
    try
    {
        var data = new TxtFileExternalData(excelDir, version: (uint)version);
        externalDataCache[version] = data;
        return data;
    }
    catch (Exception ex)
    {
        if (externalDataCache.TryGetValue(105, out var fallback))
            return fallback;
        Console.WriteLine($"Error: could not load external data for version {version} from {excelDir}: {ex.Message}");
        throw;
    }
}

try
{
    GetExternalData(105);
}
catch (Exception ex)
{
    Console.WriteLine($"Error: could not load default external data from {excelDir}: {ex.Message}");
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
    bool beepOnBest = beepSettings.Contains("best");
    bool beepOnNew = beepSettings.Contains("new");
    var speakSettings = config.GetValueOrDefault("speak", "none")
        .Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries)
        .Select(s => s.ToLowerInvariant()).ToHashSet();
    bool speakOnBest = speakSettings.Contains("best");
    bool speakOnNew = speakSettings.Contains("new");
    // Determine the matching shared stash file for this character
    string? monitorStashFile = null;
    try
    {
        var initBytes = File.ReadAllBytes(monitorFile);
        int initVer = initBytes.Length >= 8 ? BitConverter.ToInt32(initBytes, 4) : 105;
        var initSave = D2Save.Read(initBytes, GetExternalData(initVer));
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
    var regenMinutes = int.TryParse(config.GetValueOrDefault("monitor_regen_minutes", "10"), out var rm) ? rm : 10;
    var lastRegen = DateTime.Now;

    while (true)
    {
        try
        {
            // Periodically regenerate all JSON files (rescan directories for any new files)
            if ((DateTime.Now - lastRegen).TotalMinutes >= regenMinutes)
            {
                Console.WriteLine($"\n[{DateTime.Now:HH:mm:ss}] Regenerating JSON files...");
                var freshFiles = new List<string>();
                if (Directory.Exists(defaultSaveDir))
                {
                    freshFiles.AddRange(Directory.GetFiles(defaultSaveDir, "*.d2s"));
                    freshFiles.AddRange(Directory.GetFiles(defaultSaveDir, "*.d2i"));
                }
                var muleDir = config.GetValueOrDefault("mule_dir", "");
                if (muleDir.Length > 0 && Directory.Exists(muleDir))
                    freshFiles.AddRange(Directory.GetFiles(muleDir, "*.d2s"));
                foreach (var sf in freshFiles)
                {
                    if (!File.Exists(sf)) continue;
                    try
                    {
                        var bytes = File.ReadAllBytes(sf);
                        if (Path.GetExtension(sf).ToLowerInvariant() == ".d2i")
                            ProcessSharedStash(sf, bytes);
                        else
                            ProcessCharacterSave(sf, bytes);
                    }
                    catch (Exception ex) { Console.WriteLine($"  ERROR {sf}: {ex.Message}"); }
                }
                lastRegen = DateTime.Now;
            }

            byte[] saveBytes = File.ReadAllBytes(monitorFile);
            int ver = saveBytes.Length >= 8 ? BitConverter.ToInt32(saveBytes, 4) : 105;
            D2Save save = D2Save.Read(saveBytes, GetExternalData(ver));

            var allItems = new List<Item>(save.Items);
            if (save.MercItems != null)
                foreach (var item in save.MercItems.Items)
                    allItems.Add(item);

            // Collect current unique/set items by name
            var currentItems = new Dictionary<string, Item>();
            foreach (var item in allItems)
            {
                if (item.Quality is ItemQuality.Unique or ItemQuality.Set
                    && item.Flags.HasFlag(ItemFlags.Identified)
                    && !IsQuestItem(item))
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
                            if (speakOnNew) Speak($"{StripBaseType(name)} is new");
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
                                if (speakOnBest) Speak($"{StripBaseType(name)} is best");
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




string StripNonAscii(string s)
{
    var sb = new System.Text.StringBuilder(s.Length);
    foreach (var c in s)
        if (c <= 0x7E && (c >= 0x20 || c == '\t' || c == '\n' || c == '\r'))
            sb.Append(c);
    return sb.ToString();
}

bool IsExcludedByName(Item item)
{
    if (excludedItemNames.Count == 0) return false;
    var baseName = GetItemName(item.ItemCodeString);
    if (excludedItemNames.Contains(baseName)) return true;
    var displayName = GetItemDisplayName(item);
    if (excludedItemNames.Contains(displayName)) return true;
    // Also strip the "(base)" suffix and try the leading portion
    var m = Regex.Match(displayName, @"^(.*?)\s*\([^)]*\)\s*$");
    if (m.Success && excludedItemNames.Contains(m.Groups[1].Value)) return true;
    return false;
}

bool IsQuestItem(Item item)
{
    var code = item.ItemCodeString.TrimEnd('\0').Trim();
    return questItemCodes.Contains(code);
}

string StripBaseType(string name)
{
    // "Andariel's Visage (Demonhead)" -> "Andariel's Visage"
    var m = Regex.Match(name, @"^(.*?)\s*\([^)]*\)\s*$");
    return m.Success ? m.Groups[1].Value : name;
}

void Speak(string text)
{
    if (!OperatingSystem.IsWindows()) return;
    try
    {
        SpeechState.Init();
        SpeechState.SpeakAsyncMethod?.Invoke(SpeechState.Synth, new object[] { text });
    }
    catch { /* speech unavailable */ }
}

void ProcessCharacterSave(string saveFile, byte[] saveBytes)
{
    int ver = saveBytes.Length >= 8 ? BitConverter.ToInt32(saveBytes, 4) : 105;
    IExternalData externalData = GetExternalData(ver);
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

    // Corpse gear handling: If character died, equipped items are stored in save.Corpses
    bool hasCorpse = false;
    var corpseEquipped = new List<Item>();
    var remainingCorpseItems = new List<Item>();
    if (save.Corpses != null && save.Corpses.Count > 0)
    {
        hasCorpse = true;
        var occupiedSlots = new HashSet<string>(equipped.Select(i => FormatEquippedLocation(i.Position.BodyLocation)));
        foreach (var corpse in save.Corpses)
        {
            foreach (var ci in corpse.Items)
            {
                var slot = FormatEquippedLocation(ci.Position.BodyLocation);
                if (!occupiedSlots.Contains(slot))
                {
                    corpseEquipped.Add(ci);
                    occupiedSlots.Add(slot);
                }
                else
                {
                    remainingCorpseItems.Add(ci);
                }
            }
        }
    }

    var merc = new List<Item>();
    if (save.MercItems != null)
    {
        foreach (var item in save.MercItems.Items)
            merc.Add(item);
    }

    // ── Write JSON output ──

    var charDict = new Dictionary<string, object>
    {
        ["name"] = save.Character.Preview.Name,
        ["level"] = save.Character.Level,
        ["class"] = save.Character.Class.ToString(),
        ["gameVersion"] = save.Character.Preview.GameVersion.ToString(),
        ["core"] = save.Character.Flags.HasFlag(CharacterFlags.Hardcore) ? "hard" : "soft",
        ["hasCorpse"] = hasCorpse
    };

    var allItems = equipped.Where(i => !IsExcludedByName(i)).Select(i => BuildItemJson(i))
        .Concat(corpseEquipped.Where(i => !IsExcludedByName(i)).Select(i => BuildItemJson(i, isCorpse: true)))
        .Concat(belt.Concat(inventory).Concat(stash).Concat(cube).Concat(remainingCorpseItems).Where(i => !IsExcludedByName(i)).Select(i => BuildItemJson(i, isCorpse: remainingCorpseItems.Contains(i))))
        .Concat(merc.Where(i => !IsExcludedByName(i)).Select(i => BuildItemJson(i, isMercenary: true)))
        .ToList();

    var jsonData = new Dictionary<string, object>
    {
        ["catalogRevision"] = catalogRevision,
            ["saveRevision"] = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(saveBytes)),
            ["file"] = Path.GetFileName(saveFile),
        ["character"] = charDict,
        ["stats"] = BuildCharStatsJson(save),
        ["items"] = allItems,
        ["mercenary"] = merc.Where(i => !IsExcludedByName(i)).Select(i => BuildItemJson(i, isMercenary: true)).ToList()
    };

    var jsonPath = Path.ChangeExtension(saveFile, ".json");
    var json = JsonSerializer.Serialize(jsonData, jsonOptions);
    File.WriteAllText(jsonPath, StripNonAscii(json));
    // Console.WriteLine($"  JSON written to {jsonPath}");
}

void ProcessSharedStash(string saveFile, byte[] saveBytes)
{
    int ver = saveBytes.Length >= 12 ? BitConverter.ToInt32(saveBytes, 8) : 105;
    IExternalData externalData = GetExternalData(ver);
    D2StashSave stashSave = D2StashSave.Read(saveBytes, externalData);

    // Collect items per tab
    var tabItems = new List<(string TabName, uint Gold, List<Item> Items)>();
    for (int t = 0; t < stashSave.Count; t++)
    {
        var tab = stashSave[t];
        // Keep tab positions stable, including empty Chronicle tabs.
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

    var allItems = new List<Dictionary<string, object?>>();
    for (int t = 0; t < tabItems.Count; t++)
    {
        foreach (var item in tabItems[t].Items)
        {
            if (IsExcludedByName(item)) continue;
            var itJson = BuildItemJson(item);
            itJson["tabIndex"] = t;
            itJson["isAdvancedStack"] = stashSave[t].TabType == StashTabType.AdvancedStash;
            itJson["tabName"] = tabItems[t].TabName;
            allItems.Add(itJson);
        }
    }
    var jsonData = new Dictionary<string, object>
    {
        ["catalogRevision"] = catalogRevision,
            ["saveRevision"] = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(saveBytes)),
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
    var json = JsonSerializer.Serialize(jsonData, jsonOptions);
    File.WriteAllText(jsonPath, StripNonAscii(json));
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
        if (stat.Id is StatId.MaxLife or StatId.MaxMana or StatId.MaxStamina or StatId.LifePerLevel or StatId.ManaPerLevel)
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

Dictionary<string, object?> BuildItemJson(Item item, bool isMercenary = false, bool isCorpse = false)
{
    var tier = GetItemTier(item.ItemCodeString);
    var type = GetItemType(item.ItemCodeString);
    var setName = GetSetName(item);
    var statRanges = GetStatRangesForItem(item);
    var score = CalculatePerfectionScore(item, statRanges);
    var (w, h) = itemDimensions.GetSize(item.ItemCodeString);
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
        ["location"] = GetLocationString(item, isMercenary, isCorpse),
        ["itemSeed"] = item.ItemSeed,
        ["mode"] = item.Position.Mode.ToString(),
        ["storePage"] = item.Position.StorePage.ToString(),
        ["invX"] = (int)item.Position.InvX,
        ["invY"] = (int)item.Position.InvY,
        ["width"] = w,
        ["height"] = h
    };

    if (item.QualityData is SetUniqueQualityData identity)
        obj[item.Quality == ItemQuality.Set ? "setId" : "uniqueId"] = identity.SetUniqueFileIndex;
    obj["isAdvancedStack"] = item.AdvancedStashStackSize.HasValue;

    if (isMercenary)
        obj["isMercenary"] = true;
    if (isCorpse)
        obj["isCorpse"] = true;

    if (score.HasValue)
        obj["perfectionScore"] = score.Value;

    // Flags
    var flags = new List<string>();
    if (item.Flags.HasFlag(ItemFlags.Ethereal)) flags.Add("Ethereal");
    if (item.Flags.HasFlag(ItemFlags.Runeword)) flags.Add("Runeword");
    if (item.Flags.HasFlag(ItemFlags.Socketed)) flags.Add($"Socketed ({item.Sockets.Count})");
    if (!item.Flags.HasFlag(ItemFlags.Identified)) flags.Add("Unidentified");
    if (item.Flags.HasFlag(ItemFlags.Personalized)) flags.Add("Personalized");

    bool isCorrupted = false;
    if (item.Stats != null)
    {
        foreach (var s in item.Stats)
        {
            int sId = (int)s.Id;
            if (sId == 368 || (statCostLookup.TryGetValue(sId, out var sci) && (sci.StatName.Equals("corrupted", StringComparison.OrdinalIgnoreCase) || sci.StatName.Equals("item_corrupted", StringComparison.OrdinalIgnoreCase))))
            {
                if (s.Value > 0)
                    isCorrupted = true;
            }
        }
    }
    if (isCorrupted)
    {
        obj["isCorrupted"] = true;
        flags.Add("Corrupted");
    }

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
    else if (item.AdvancedStashStackSize.HasValue)
        obj["quantity"] = (int)item.AdvancedStashStackSize.Value;

    var internalStats = new List<Dictionary<string, object>>();

    if (item.RunewordStats?.Count > 0)
    {
        var rwList = new List<Dictionary<string, object>>();
        foreach (var s in item.RunewordStats)
        {
            var formatted = FormatStatJson(s, statRanges);
            if (formatted != null)
                rwList.Add(formatted);
            else
                internalStats.Add(new Dictionary<string, object> { ["id"] = ((int)s.Id).ToString(), ["value"] = s.Value });
        }
        if (rwList.Count > 0)
            obj["runewordStats"] = rwList;
    }

    if (item.Stats?.Count > 0)
    {
        var statList = new List<Dictionary<string, object>>();
        foreach (var s in item.Stats)
        {
            var formatted = FormatStatJson(s, item.RunewordStats?.Count > 0 ? null : statRanges);
            if (formatted != null)
                statList.Add(formatted);
            else
                internalStats.Add(new Dictionary<string, object> { ["id"] = ((int)s.Id).ToString(), ["value"] = s.Value });
        }
        if (statList.Count > 0)
            obj["stats"] = statList;
    }

    if (internalStats.Count > 0)
        obj["internalStats"] = internalStats;

    for (int i = 0; i < (item.SetBonusStats?.Count ?? 0); i++)
    {
        if (item.SetBonusStats![i] != null && item.SetBonusStats[i].Count > 0)
        {
            var sbList = item.SetBonusStats[i].Select(s => FormatStatJson(s, null)).Where(s => s != null).Select(s => s!).ToList();
            if (sbList.Count > 0)
            {
                obj[$"setBonus{i + 1}"] = sbList;
            }
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

    var issues = new List<string>();
    var allItemStats = new List<Dictionary<string, object>>();
    if (obj.TryGetValue("runewordStats", out var rws) && rws is List<Dictionary<string, object>> rList)
        allItemStats.AddRange(rList);
    if (obj.TryGetValue("stats", out var sts) && sts is List<Dictionary<string, object>> sList)
        allItemStats.AddRange(sList);

    foreach (var st in allItemStats)
    {
        if (st.TryGetValue("outOfRange", out var oor))
        {
            var desc = st.GetValueOrDefault("description")?.ToString() ?? st.GetValueOrDefault("id")?.ToString() ?? "Stat";
            var val = st.GetValueOrDefault("value");
            var min = st.GetValueOrDefault("expectedMin");
            var max = st.GetValueOrDefault("expectedMax");
            if (oor?.ToString() == "below_min")
                issues.Add($"{desc} [Value: {val}] is BELOW current min {min}");
            else if (oor?.ToString() == "above_max")
                issues.Add($"{desc} [Value: {val}] is ABOVE current max {max}");
        }
    }

    if (statRanges != null && statRanges.Count > 0)
    {
        var presentKeys = new HashSet<(int StatId, int Layer)>();
        if (item.Stats != null)
            foreach (var s in item.Stats)
                presentKeys.Add(((int)s.Id, s.Layer));
        if (item.RunewordStats != null)
            foreach (var s in item.RunewordStats)
                presentKeys.Add(((int)s.Id, s.Layer));

        foreach (var kvp in statRanges)
        {
            if (!presentKeys.Contains(kvp.Key))
            {
                var statName = FormatStatKeyDescription(kvp.Key.StatId, kvp.Key.Layer, kvp.Value);
                issues.Add($"Missing stat: {statName} [{kvp.Value.Min}-{kvp.Value.Max}] from current game file");
            }
        }
    }

    if (issues.Count > 0)
    {
        obj["isOutOfDate"] = true;
        obj["outOfDateIssues"] = issues;
    }
    else
    {
        obj["isOutOfDate"] = false;
    }

    obj["verificationStatus"] = issues.Count > 0 ? "mismatch" : statRanges?.Count > 0 ? "partial" : "unknown";
    return obj;
}

Dictionary<string, object>? FormatStatJson(Stat stat, Dictionary<(int StatId, int Layer), (int Min, int Max)>? ranges)
{
    var statIntId = (int)stat.Id;
    if (statCostLookup.TryGetValue(statIntId, out var costInfo))
    {
        // If this stat has no description function and no display strings, it is an engine internal stat (e.g. corruptordesc 369)
        if (costInfo.DescFunc <= 0 && string.IsNullOrEmpty(costInfo.DescStrPos) && string.IsNullOrEmpty(costInfo.DescStrNeg))
        {
            return null;
        }
    }

    string idStr = stat.Id.ToString();
    if (int.TryParse(idStr, out _) && statCostLookup.TryGetValue(statIntId, out var ci) && !string.IsNullOrEmpty(ci.StatName))
    {
        idStr = ci.StatName;
    }

    var obj = new Dictionary<string, object>
    {
        ["id"] = idStr,
        ["description"] = FormatStat(stat)
    };

    var value = stat.Value;
    if (stat.Id is StatId.MaxLife or StatId.MaxMana or StatId.MaxStamina or StatId.LifePerLevel or StatId.ManaPerLevel)
        value >>= 8;
    obj["value"] = value;

    if (stat.Layer != 0)
        obj["layer"] = stat.Layer;

    if (ranges != null && ranges.TryGetValue(((int)stat.Id, stat.Layer), out var range))
    {
        obj["range"] = $"{range.Min}-{range.Max}";
        obj["expectedMin"] = range.Min;
        obj["expectedMax"] = range.Max;
        if (value < range.Min)
            obj["outOfRange"] = "below_min";
        else if (value > range.Max)
            obj["outOfRange"] = "above_max";
    }

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

string FormatEquippedLocation(BodyLocation loc) => loc switch
{
    BodyLocation.Head => "Head",
    BodyLocation.Neck => "Neck",
    BodyLocation.Torso => "Torso",
    BodyLocation.RightArm => "RightHand",
    BodyLocation.LeftArm => "LeftHand",
    BodyLocation.RightRing => "RightRing",
    BodyLocation.LeftRing => "LeftRing",
    BodyLocation.Belt => "Belt",
    BodyLocation.Feet => "Boots",
    BodyLocation.Gloves => "Gloves",
    BodyLocation.RightHand => "AlternateRightHand",
    BodyLocation.LeftHand => "AlternateLeftHand",
    _ => loc.ToString()
};

string GetLocationString(Item item, bool isMercenary = false, bool isCorpse = false)
{
    if (isMercenary)
    {
        if (item.Position.Mode == ItemMode.Equipped)
            return $"Mercenary: {FormatEquippedLocation(item.Position.BodyLocation)}";
        return "Mercenary";
    }

    if (item.Position.Mode == ItemMode.Equipped)
        return FormatEquippedLocation(item.Position.BodyLocation);
    if (item.Position.Mode == ItemMode.InBelt)
        return "InBelt";
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
    var statIntId = (int)stat.Id;
    var value = stat.Value;

    if (stat.Id is StatId.MaxLife or StatId.MaxMana or StatId.MaxStamina or StatId.LifePerLevel or StatId.ManaPerLevel)
        value >>= 8;

    if (IsPerLevelStat(stat.Id))
    {
        var desc = GetPerLevelDescription(stat.Id);
        return $"+{value / 8.0:0.###} {desc} (per level)";
    }

    if (stat.Id == StatId.Aura || statIntId == 151)
    {
        var skillName = GetSkillName(StatId.Aura, stat.Layer);
        return $"Level {value} {skillName} Aura When Equipped";
    }

    if (stat.Id == StatId.ItemChargedSkill || statIntId == 204)
    {
        int skillLevel = stat.Layer & 0x3F;
        int skillId = stat.Layer >> 6;
        int curCharges = (int)(value & 0xFF);
        int maxCharges = (int)((value >> 8) & 0xFF);
        var skillName = GetSkillName(StatId.SingleSkill, skillId);
        return $"Level {skillLevel} {skillName} ({curCharges}/{maxCharges} Charges)";
    }

    if (statIntId is 195 or 196 or 197 or 198 or 199 or 201)
    {
        int skillLevel = stat.Layer & 0x3F;
        int skillId = stat.Layer >> 6;
        var skillName = GetSkillName(StatId.SingleSkill, skillId);
        int chance = (int)value;
        return statIntId switch
        {
            195 => $"{chance}% Chance to cast level {skillLevel} {skillName} on attack",
            196 => $"{chance}% Chance to cast level {skillLevel} {skillName} when you Kill an Enemy",
            197 => $"{chance}% Chance to cast level {skillLevel} {skillName} when you Die",
            198 => $"{chance}% Chance to cast level {skillLevel} {skillName} on striking",
            199 => $"{chance}% Chance to cast level {skillLevel} {skillName} when you Level-Up",
            201 => $"{chance}% Chance to cast level {skillLevel} {skillName} when struck",
            _ => $"{chance}% Chance to cast level {skillLevel} {skillName}"
        };
    }

    if (IsSkillStat(stat.Id) && (stat.Layer != 0
        || stat.Id == StatId.AddClassSkills || stat.Id == StatId.AddSkillTab))
    {
        var skillName = GetSkillName(stat.Id, stat.Layer);
        return $"+{value} to {skillName}";
    }

    // Check custom / loaded stat metadata from itemstatcost.txt and string table
    if (statCostLookup.TryGetValue(statIntId, out var info))
    {
        // 1. descfunc == 3: String only, no value (e.g. "Corrupted", "Augmented", "Freezes Target", "Knockback")
        if (info.DescFunc == 3)
        {
            var strKey = !string.IsNullOrEmpty(info.DescStrPos) ? info.DescStrPos : info.DescStrNeg;
            if (!string.IsNullOrEmpty(strKey) && stringTable.TryGetValue(strKey, out var localized) && !string.IsNullOrWhiteSpace(localized))
                return localized;
            if (!string.IsNullOrEmpty(info.StatName))
                return FormatRawStatName(info.StatName);
        }

        // 2. Format with string table if descstrpos / descstrneg is present
        var keyToUse = value >= 0 ? info.DescStrPos : (string.IsNullOrEmpty(info.DescStrNeg) ? info.DescStrPos : info.DescStrNeg);
        if (!string.IsNullOrEmpty(keyToUse) && stringTable.TryGetValue(keyToUse, out var localizedStr) && !string.IsNullOrWhiteSpace(localizedStr))
        {
            // If string contains printf-style specifiers: %+d, %d, %i, %%
            if (localizedStr.Contains("%+d") || localizedStr.Contains("%d") || localizedStr.Contains("%i"))
            {
                var formatted = localizedStr;
                var signedVal = (value >= 0 ? "+" : "") + value;
                formatted = formatted.Replace("%+d", signedVal);
                formatted = formatted.Replace("%d", value.ToString());
                formatted = formatted.Replace("%i", value.ToString());
                formatted = formatted.Replace("%%", "%");
                formatted = formatted.Replace("%0%", "%");
                return formatted;
            }

            // If descfunc is 15 or 20 without %d (e.g. "Melee Splash Damage")
            if (info.DescFunc is 15 or 20)
            {
                return localizedStr;
            }

            // If descval == 1: value before string (+X Fire Resist)
            if (info.DescVal == 1)
                return $"{(value >= 0 ? "+" : "")}{value} {localizedStr}";

            // If descval == 2: value after string (Fire Resist: +X)
            if (info.DescVal == 2)
                return $"{localizedStr}: {(value >= 0 ? "+" : "")}{value}";

            // If descfunc is 19 without %d
            if (info.DescFunc == 19)
                return $"{(value >= 0 ? "+" : "")}{value} {localizedStr}";

            return $"{localizedStr}: {value}";
        }
    }

    var name = FormatStatName(stat.Id);

    if (IsPercentStat(stat.Id))
        return $"{name}: {(value >= 0 ? "+" : "")}{value}%";

    if (IsSignedStat(stat.Id))
        return $"{name}: {(value >= 0 ? "+" : "")}{value}";

    return $"{name}: {value}";
}

string FormatStatKeyDescription(int statId, int layer, (int Min, int Max) range)
{
    var statIdEnum = (StatId)statId;
    var rangeStr = range.Min == range.Max ? $"{range.Min}" : $"{range.Min}-{range.Max}";

    if (statIdEnum == StatId.AddClassSkills)
    {
        var className = GetSkillName(StatId.AddClassSkills, layer);
        return $"+{rangeStr} to {className}";
    }
    if (statIdEnum == StatId.AddSkillTab)
    {
        var tabName = GetSkillName(StatId.AddSkillTab, layer);
        return $"+{rangeStr} to {tabName}";
    }
    if (statIdEnum == StatId.NonClassSkill)
    {
        var skillName = GetSkillName(StatId.NonClassSkill, layer);
        return $"+{rangeStr} to {skillName} (oskill)";
    }
    if (statIdEnum == StatId.SingleSkill)
    {
        var skillName = GetSkillName(StatId.SingleSkill, layer);
        return $"+{rangeStr} to {skillName}";
    }
    if (statIdEnum == StatId.Aura || statId == 151)
    {
        var auraName = GetSkillName(StatId.Aura, layer);
        return $"Level {rangeStr} {auraName} Aura When Equipped";
    }

    if (statId == 204 || statIdEnum == StatId.ItemChargedSkill)
    {
        int skillLevel = layer & 0x3F;
        int skillId = layer >> 6;
        var skillName = GetSkillName(StatId.SingleSkill, skillId);
        return $"Level {skillLevel} {skillName} Charges";
    }

    if (statId is 195 or 196 or 197 or 198 or 199 or 201)
    {
        int skillLevel = layer & 0x3F;
        int skillId = layer >> 6;
        var skillName = GetSkillName(StatId.SingleSkill, skillId);
        return statId switch
        {
            195 => $"{rangeStr}% Chance to cast level {skillLevel} {skillName} on attack",
            196 => $"{rangeStr}% Chance to cast level {skillLevel} {skillName} when you Kill an Enemy",
            197 => $"{rangeStr}% Chance to cast level {skillLevel} {skillName} when you Die",
            198 => $"{rangeStr}% Chance to cast level {skillLevel} {skillName} on striking",
            199 => $"{rangeStr}% Chance to cast level {skillLevel} {skillName} when you Level-Up",
            201 => $"{rangeStr}% Chance to cast level {skillLevel} {skillName} when struck",
            _ => $"{rangeStr}% Chance to cast level {skillLevel} {skillName}"
        };
    }

    if (statCostLookup.TryGetValue(statId, out var costInfo) && costInfo.StatName.Equals("item_elemskill", StringComparison.OrdinalIgnoreCase))
    {
        var elemName = layer switch
        {
            1 => "Fire Skills",
            2 => "Lightning Skills",
            3 => "Magic Skills",
            4 => "Cold Skills",
            5 => "Poison Skills",
            _ => "Elemental Skills"
        };
        return $"+{rangeStr} to {elemName}";
    }

    return FormatStatName(statIdEnum);
}

string FormatStatName(StatId id)
{
    int statIntId = (int)id;
    if (statCostLookup.TryGetValue(statIntId, out var info))
    {
        var keyToUse = !string.IsNullOrEmpty(info.DescStrPos) ? info.DescStrPos : info.DescStrNeg;
        if (!string.IsNullOrEmpty(keyToUse) && stringTable.TryGetValue(keyToUse, out var localized) && !string.IsNullOrWhiteSpace(localized))
        {
            var cleaned = Regex.Replace(localized, @"%[-+0-9]*[a-zA-Z%]", "").Trim();
            cleaned = Regex.Replace(cleaned, @"^to\s+", "", RegexOptions.IgnoreCase).Trim();
            if (!string.IsNullOrWhiteSpace(cleaned))
                return cleaned;
        }
        if (!string.IsNullOrEmpty(info.StatName))
        {
            return FormatRawStatName(info.StatName);
        }
    }

    var name = id.ToString();
    if (int.TryParse(name, out _))
        return $"Stat #{name}";
    return Regex.Replace(name, "([a-z])([A-Z])", "$1 $2");
}

string FormatRawStatName(string name)
{
    if (string.IsNullOrWhiteSpace(name)) return "";
    if (name.StartsWith("item_", StringComparison.OrdinalIgnoreCase))
        name = name.Substring(5);
    else if (name.StartsWith("pl_", StringComparison.OrdinalIgnoreCase))
        name = name.Substring(3);

    var words = name.Split('_', StringSplitOptions.RemoveEmptyEntries);
    for (int i = 0; i < words.Length; i++)
    {
        var w = words[i];
        if (w.Equals("percent", StringComparison.OrdinalIgnoreCase) || w.Equals("pct", StringComparison.OrdinalIgnoreCase))
            words[i] = "%";
        else if (w.Equals("str", StringComparison.OrdinalIgnoreCase))
            words[i] = "Strength";
        else if (w.Equals("dex", StringComparison.OrdinalIgnoreCase))
            words[i] = "Dexterity";
        else if (w.Equals("vit", StringComparison.OrdinalIgnoreCase))
            words[i] = "Vitality";
        else if (w.Equals("enr", StringComparison.OrdinalIgnoreCase))
            words[i] = "Energy";
        else if (w.Equals("elemskill", StringComparison.OrdinalIgnoreCase))
            words[i] = "Elemental Skill";
        else if (w.Length > 0)
            words[i] = char.ToUpperInvariant(w[0]) + w.Substring(1);
    }
    return string.Join(" ", words);
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
    StatId.AddClassSkills or StatId.Aura;

string GetSkillName(StatId statType, int id)
{
    if (statType == StatId.Aura)
        return skillNames.TryGetValue(id, out var auraName) ? auraName : $"Aura #{id}";

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

string NormalizePropertyCode(string propCode)
{
    if (string.IsNullOrEmpty(propCode)) return "";
    return propCode.Trim().ToLowerInvariant() switch
    {
        "cast" => "cast1",
        "balance" => "balance1",
        "move" => "move1",
        "swing" => "swing1",
        "block" => "block1",
        "cold-res" => "res-cold",
        "fire-res" => "res-fire",
        "ltng-res" => "res-ltng",
        "pois-res" => "res-pois",
        "all-res" => "res-all",
        "ern%" => "enr%",
        "res-poi-len" => "res-pois-len",
        "get-hit-skill" => "gethit-skill",
        _ => propCode.Trim()
    };
}

string? ResolvePropertyToText(string propCode, string param, int min, int max)
{
    if (string.IsNullOrEmpty(propCode)) return null;

    var normCode = NormalizePropertyCode(propCode);
    if (!propertyToStats.TryGetValue(normCode, out var propEntries) && !propertyToStats.TryGetValue(propCode, out propEntries))
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
                if (int.TryParse(param, out var tabId))
                {
                    int saveLayer = (tabId / 3) * 8 + (tabId % 3);
                    parts.Add($"+{value} to {GetSkillName(StatId.AddSkillTab, saveLayer)}");
                }
                else
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
                int skillId = -1;
                if (int.TryParse(param, out var pid)) skillId = pid;
                else if (skillNameToId.TryGetValue(param, out var sId)) skillId = sId;
                else
                {
                    var clean = Regex.Replace(param, @"[^a-zA-Z0-9]", "").ToLowerInvariant();
                    if (skillNameToId.TryGetValue(clean, out var cId)) skillId = cId;
                }
                var sName = skillNames.TryGetValue(skillId, out var sn) ? sn : $"Skill {param}";
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





Dictionary<string, string> BuildStringTable(string dir)
{
    // Load localized string tables (Key -> enUS) for items, runes, skills, and modifiers.
    // The strings dir lives at ../../local/lng/strings relative to the excel dir.
    var lookup = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

    var candidateDirs = new List<string>();
    var relStrings = Path.GetFullPath(Path.Combine(dir, "..", "..", "local", "lng", "strings"));
    if (Directory.Exists(relStrings)) candidateDirs.Add(relStrings);
    var relLegacy = Path.GetFullPath(Path.Combine(dir, "..", "..", "local", "lng", "strings-legacy"));
    if (Directory.Exists(relLegacy)) candidateDirs.Add(relLegacy);

    var baseStrings = @"E:\Games\Diablo II Resurrected\Data\local\lng\strings";
    if (Directory.Exists(baseStrings) && !candidateDirs.Contains(baseStrings, StringComparer.OrdinalIgnoreCase))
        candidateDirs.Add(baseStrings);

    var stringFiles = new[]
    {
        "item-names.json",
        "item-runes.json",
        "item-modifiers.json",
        "item-nameaffixes.json",
        "skills.json",
        "ui.json"
    };

    // Load from fallback first, so mod-specific strings overwrite base
    candidateDirs.Reverse();
    foreach (var sDir in candidateDirs)
    {
        foreach (var file in stringFiles)
        {
            var path = Path.Combine(sDir, file);
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
                    if (key != null && en != null)
                        lookup[key] = GameDataTables.CleanItemName(en);
                }
            }
            catch { /* skip on parse error */ }
        }
    }
    return lookup;
}









// gemapplytype: 0=weapon, 1=armor/helm, 2=shield






















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



// Cached single SpeechSynthesizer so SpeakAsync calls queue up rather than overlap
static class SpeechState
{
    public static object? Synth;
    public static System.Reflection.MethodInfo? SpeakAsyncMethod;
    static bool _initialized;
    public static void Init()
    {
        if (_initialized) return;
        _initialized = true;
        if (!OperatingSystem.IsWindows()) return;
        var asm = System.Reflection.Assembly.Load("System.Speech");
        var type = asm.GetType("System.Speech.Synthesis.SpeechSynthesizer");
        if (type == null) return;
        Synth = Activator.CreateInstance(type);
        SpeakAsyncMethod = type.GetMethod("SpeakAsync", new[] { typeof(string) });
    }
}
