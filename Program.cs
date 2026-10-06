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
    Path.GetFullPath("mods/BKDiablo/bkdiablo.mpq/data/global/excel"));
var defaultSaveDir = config.GetValueOrDefault("save_dir",
    Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
        "Saved Games", "Diablo II Resurrected"));

var filteredArgs = new List<string>();
string? catalogRevisionOverride = null;
for (int i = 0; i < args.Length; i++)
{
    if (args[i] == "--excel" && i + 1 < args.Length)
    {
        excelDir = args[++i];
    }
    else if (args[i] == "--catalog-revision" && i + 1 < args.Length)
    {
        catalogRevisionOverride = args[++i];
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

// Check for update-chronicle mode
if (args.Length >= 1 && (args[0] == "update-chronicle" || args[0] == "--update-chronicle"))
{
    int exitCode = D2SItems.ChronicleUpdater.RunCli(args, defaultSaveDir, excelDir);
    Environment.Exit(exitCode);
    return;
}

if (args.Length > 0 && (args[0] == "commit-workspace" || args[0] == "pack-workspace"))
{
    Environment.ExitCode = EditWorkspaceCli.Run(args[0], excelDir);
    return;
}

if (args.Length >= 1 && (args[0] == "create-item" || args[0] == "--create-item"))
{
    Environment.ExitCode = D2SItems.NetNewItemManager.RunCli(args, excelDir);
    return;
}

if (args.Length >= 1 && (args[0] == "export-unique-catalog" || args[0] == "--export-unique-catalog"))
{
    var outputPath = args.Length > 1 ? args[1] : Path.Combine("web", "unique_items_catalog.json");
    var catalogEngine = new SaveInspectorEngine(excelDir);
    var catalog = catalogEngine.ExportUniqueItemsCatalog();
    var json = System.Text.Json.JsonSerializer.Serialize(catalog, new System.Text.Json.JsonSerializerOptions { WriteIndented = true });
    var dir = Path.GetDirectoryName(Path.GetFullPath(outputPath));
    if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir)) Directory.CreateDirectory(dir);
    File.WriteAllText(outputPath, json);
    Console.WriteLine($"Exported {catalog.Count} unique items to {outputPath}");
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

var excludedItemNames = config.GetValueOrDefault("exclude_items", "")
    .Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries)
    .ToHashSet(StringComparer.OrdinalIgnoreCase);

var engine = new SaveInspectorEngine(excelDir, null, excludedItemNames, catalogRevisionOverride);

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
        string jsonStr;
        if (ext == ".d2i")
            jsonStr = engine.ProcessSharedStashToJson(saveFile, saveBytes);
        else
            jsonStr = engine.ProcessCharacterSaveToJson(saveFile, saveBytes);
        
        var jsonPath = Path.ChangeExtension(saveFile, ".json");
        File.WriteAllText(jsonPath, jsonStr);
    }
    catch (Exception ex)
    {
        Console.WriteLine($"  ERROR processing {saveFile}: {ex.Message}");
        Environment.ExitCode = 1;
    }
}

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
        var initData = engine.ProcessCharacterSaveData(monitorFile, initBytes);
        var charDict = (Dictionary<string, object>)initData["character"];
        var charGameVersion = charDict["gameVersion"].ToString();
        var charCore = charDict["core"].ToString() == "hard" ? "HardCore" : "SoftCore";
        monitorStashFile = Path.Combine(Path.GetDirectoryName(monitorFile)!, $"SharedStash_{charCore}_V{charGameVersion}.d2i");
    }
    catch { }

    Console.WriteLine($"\nMonitoring {Path.GetFileName(monitorFile)} for unique/set drops (Interval: {monitorInterval}s)...");
    Console.WriteLine("Press Ctrl+C to exit.\n");

    Dictionary<string, Dictionary<string, object?>> previousItems = new();
    bool firstRun = true;
    var regenMinutes = int.TryParse(config.GetValueOrDefault("monitor_regen_minutes", "10"), out var rm) ? rm : 10;
    DateTime lastRegen = DateTime.Now;

    while (true)
    {
        try
        {
            // Re-run JSON generation every 10 minutes (useful for external web UI updates)
            if ((DateTime.Now - lastRegen).TotalMinutes >= regenMinutes)
            {
                foreach (var sf in saveFiles)
                {
                    try
                    {
                        var ext = Path.GetExtension(sf).ToLowerInvariant();
                        var bytes = File.ReadAllBytes(sf);
                        if (ext == ".d2i")
                            File.WriteAllText(Path.ChangeExtension(sf, ".json"), engine.ProcessSharedStashToJson(sf, bytes));
                        else
                            File.WriteAllText(Path.ChangeExtension(sf, ".json"), engine.ProcessCharacterSaveToJson(sf, bytes));
                    }
                    catch (Exception ex) { Console.WriteLine($"  ERROR {sf}: {ex.Message}"); }
                }
                lastRegen = DateTime.Now;
            }

            var saveBytes = File.ReadAllBytes(monitorFile);
            var charData = engine.ProcessCharacterSaveData(monitorFile, saveBytes);
            var itemsList = (List<Dictionary<string, object?>>)charData["items"];
            
            // Collect current unique/set items by name
            var currentItems = new Dictionary<string, Dictionary<string, object?>>();
            foreach (var item in itemsList)
            {
                if (item != null && item.ContainsKey("quality") && item.ContainsKey("name") && item.ContainsKey("isUnidentified"))
                {
                    var quality = item["quality"]?.ToString();
                    var isUnid = item["isUnidentified"] is bool b && b;
                    if ((quality == "Unique" || quality == "Set") && !isUnid)
                    {
                        var name = item["name"]?.ToString() ?? "";
                        currentItems.TryAdd(name, item);
                    }
                }
            }

            if (!firstRun)
            {
                foreach (var (name, itemDict) in currentItems)
                {
                    if (!previousItems.ContainsKey(name))
                    {
                        var timestamp = DateTime.Now.ToString("HH:mm:ss");
                        var score = itemDict.ContainsKey("perfectionScore") && itemDict["perfectionScore"] != null ? (double?)Convert.ToDouble(itemDict["perfectionScore"]) : null;
                        var scoreStr = score.HasValue ? $" - (Perfection: {score:F2}%)" : " - (No Perfection Score)";
                        
                        var flags = itemDict.TryGetValue("flags", out var flagsVal) && flagsVal is List<string> flList ? flList : new List<string>();
                        var ethStr = flags.Contains("Ethereal") ? " [ETH]" : "";
                        
                        Console.WriteLine($"\n------\n");
                        Console.WriteLine($"[{timestamp}] NEW ITEM DETECTED: {name}{ethStr}{scoreStr}");
                        if (score.HasValue)
                        {
                            if (itemDict.ContainsKey("defense"))
                            {
                                var def = itemDict["defense"];
                                var baseDefRange = engine.GetBaseDefenseRange(itemDict["itemCode"]?.ToString() ?? "");
                                if (baseDefRange != null)
                                    Console.WriteLine($"  Defense: {def} (base: {baseDefRange})");
                                else
                                    Console.WriteLine($"  Defense: {def}");
                            }
                            
                            var statsList = new List<Dictionary<string, object>>();
                            if (itemDict.TryGetValue("runewordStats", out var rws) && rws is List<Dictionary<string, object>> rList)
                                statsList.AddRange(rList);
                            if (itemDict.TryGetValue("stats", out var sts) && sts is List<Dictionary<string, object>> sList)
                                statsList.AddRange(sList);
                                
                            foreach (var stat in statsList)
                            {
                                var text = stat.ContainsKey("description") ? stat["description"]?.ToString() : stat["id"]?.ToString();
                                if (stat.ContainsKey("range"))
                                    Console.WriteLine($"  {text} [{stat["range"]}]");
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
                                File.WriteAllText(Path.ChangeExtension(monitorStashFile, ".json"), engine.ProcessSharedStashToJson(monitorStashFile, stashBytes));
                            }
                            catch { }
                        }

                        // Find existing copies across all saves
                        var existing = FindExistingItems(name, Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "find_item.py"));
                        bool isBest = false;
                        
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
                            if (speakOnNew) Speak($"{name} is new");
                        }
                        else
                        {
                            Console.WriteLine($"  You already have {existing.Count} of this item.");
                            if (score.HasValue)
                            {
                                double bestScore = 0;
                                foreach (var copy in existing)
                                {
                                    if (copy.TryGetProperty("perfectionScore", out var s) && s.ValueKind == JsonValueKind.Number)
                                    {
                                        double cs = s.GetDouble();
                                        if (cs > bestScore) bestScore = cs;
                                    }
                                }
                                Console.WriteLine($"  Best existing perfection: {bestScore:F2}%");
                                if (score.Value > bestScore)
                                {
                                    Console.WriteLine($"************** THIS IS YOUR BEST ONE YET! ***************");
                                    isBest = true;
                                    if (beepOnBest) Console.Beep();
                                    if (speakOnBest) Speak($"New best {name} at {Math.Round(score.Value)} percent");
                                }
                            }
                        }
                        
                        // Execute external webhook if configured
                        var webhookUrl = config.GetValueOrDefault("webhook", "");
                        if (!string.IsNullOrEmpty(webhookUrl))
                        {
                            try
                            {
                                var webhookJson = JsonSerializer.Serialize(new
                                {
                                    content = $"**{name}{ethStr}** dropped!{scoreStr}\\n" +
                                              $"Copies: {existing.Count} (Eth: {existingEth}, Non: {existingNonEth})\\n" +
                                              $"Is Best: {isBest}"
                                });
                                using var httpClient = new HttpClient();
                                using var postContent = new StringContent(webhookJson, System.Text.Encoding.UTF8, "application/json");
                                var res = httpClient.PostAsync(webhookUrl, postContent).GetAwaiter().GetResult();
                            }
                            catch (Exception ex) { Console.WriteLine($"  Webhook Error: {ex.Message}"); }
                        }
                    }
                }
            }

            firstRun = false;
            previousItems = currentItems;
        }
        catch (Exception ex)
        {
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

Dictionary<string, string> LoadConfig(string filename)
{
    var config = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
    var searchPaths = new[]
    {
        Path.Combine(AppDomain.CurrentDomain.BaseDirectory, filename),
        Path.Combine(Environment.CurrentDirectory, filename)
    };
    foreach (var path in searchPaths)
    {
        if (File.Exists(path))
        {
            foreach (var line in File.ReadAllLines(path))
            {
                var trimmed = line.Trim();
                if (trimmed.Length == 0 || trimmed.StartsWith("#") || trimmed.StartsWith(";"))
                    continue;
                var split = trimmed.Split('=', 2);
                if (split.Length == 2)
                    config[split[0].Trim()] = split[1].Trim();
            }
            break;
        }
    }
    return config;
}

static class SpeechState
{
    public static object? Synth;
    public static System.Reflection.MethodInfo? SpeakAsyncMethod;
    static bool _initialized;
    public static void Init()
    {
        if (_initialized) return;
        _initialized = true;
        try
        {
            var assem = System.Reflection.Assembly.Load("System.Speech, Version=4.0.0.0, Culture=neutral, PublicKeyToken=31bf3856ad364e35");
            var type = assem.GetType("System.Speech.Synthesis.SpeechSynthesizer");
            if (type != null)
            {
                Synth = Activator.CreateInstance(type);
                SpeakAsyncMethod = type.GetMethod("SpeakAsync", new[] { typeof(string) });
            }
        }
        catch { }
    }
}
