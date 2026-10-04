using System.Text.RegularExpressions;
using System.Text.Json;

namespace D2SItems;

public static class GameDataTables
{
    public static bool IsAdvancedBankItem(string code, string excelDir)
    {
        var path = Path.GetFullPath(Path.Combine(excelDir, "..", "ui", "layouts", "bankexpansionlayouthd.json"));
        using var layout = JsonDocument.Parse(File.ReadAllBytes(path));
        return layout.RootElement.GetProperty("children").EnumerateArray()
            .Where(node => node.TryGetProperty("name", out var name) && name.GetString() is "advancedstash_gems" or "advancedstash_materials")
            .SelectMany(node => node.GetProperty("children").EnumerateArray())
            .Any(node => node.GetProperty("fields").TryGetProperty("itemCode", out var itemCode)
                && string.Equals(itemCode.GetString(), code, StringComparison.OrdinalIgnoreCase));
    }

    public static string Revision(string directory)
    {
        var manifest = string.Join("", Directory.EnumerateFiles(directory, "*.txt")
            .OrderBy(path => Path.GetFileName(path), StringComparer.OrdinalIgnoreCase)
            .Select(path => Path.GetFileName(path).ToLowerInvariant() + ":" +
                Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(File.ReadAllBytes(path))) + "\n"));
        return Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(manifest)));
    }

public static Dictionary<string, List<PropertyEntry>> BuildPropertyToStatsLookup(string dir)
{
    var lookup = new Dictionary<string, List<PropertyEntry>>(StringComparer.OrdinalIgnoreCase);
    var path = Path.Combine(dir, "properties.txt");
    if (!File.Exists(path)) { return lookup; }

    var lines = File.ReadAllLines(path);
    if (lines.Length < 2) return lookup;

    var header = lines[0].Split('\t');
    int codeIdx = Array.IndexOf(header, "code");
    var funcIndices = new int[7];
    var statIndices = new int[7];
    var valIndices = new int[7];
    for (int f = 0; f < 7; f++)
    {
        funcIndices[f] = Array.IndexOf(header, $"func{f + 1}");
        statIndices[f] = Array.IndexOf(header, $"stat{f + 1}");
        valIndices[f] = Array.IndexOf(header, $"val{f + 1}");
    }

    for (int i = 1; i < lines.Length; i++)
    {
        var cols = lines[i].Split('\t');
        if (cols.Length <= codeIdx) continue;
        var code = cols[codeIdx].Trim();
        if (code.Length == 0) continue;

        var entries = new List<PropertyEntry>();
        for (int f = 0; f < 7; f++)
        {
            if (funcIndices[f] < 0 || funcIndices[f] >= cols.Length) continue;
            var funcStr = cols[funcIndices[f]].Trim();
            if (!int.TryParse(funcStr, out var func)) continue;
            var stat = (statIndices[f] >= 0 && statIndices[f] < cols.Length)
                ? cols[statIndices[f]].Trim() : "";
            var val = (valIndices[f] >= 0 && valIndices[f] < cols.Length)
                ? cols[valIndices[f]].Trim() : "";
            entries.Add(new PropertyEntry(func, stat, val));
        }

        if (entries.Count > 0)
            lookup[code] = entries;
    }

    return lookup;
}

public static Dictionary<string, int> BuildStatNameToIdLookup(string dir)
{
    var lookup = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
    var path = Path.Combine(dir, "itemstatcost.txt");
    if (!File.Exists(path)) { return lookup; }

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

public static Dictionary<int, StatCostInfo> BuildStatCostLookup(string dir)
{
    var lookup = new Dictionary<int, StatCostInfo>();
    var path = Path.Combine(dir, "itemstatcost.txt");
    if (!File.Exists(path)) return lookup;

    var lines = File.ReadAllLines(path);
    if (lines.Length < 2) return lookup;

    var header = lines[0].Split('\t');
    int nameIdx = Array.IndexOf(header, "Stat");
    int idIdx = Array.IndexOf(header, "*ID");
    int priorityIdx = Array.IndexOf(header, "descpriority");
    int funcIdx = Array.IndexOf(header, "descfunc");
    int valIdx = Array.IndexOf(header, "descval");
    int posIdx = Array.IndexOf(header, "descstrpos");
    int negIdx = Array.IndexOf(header, "descstrneg");
    int str2Idx = Array.IndexOf(header, "descstr2");

    if (idIdx < 0 || nameIdx < 0) return lookup;

    for (int i = 1; i < lines.Length; i++)
    {
        var cols = lines[i].Split('\t');
        if (cols.Length > idIdx && int.TryParse(cols[idIdx].Trim(), out var id))
        {
            var statName = cols.Length > nameIdx ? cols[nameIdx].Trim() : "";
            int priority = (priorityIdx >= 0 && cols.Length > priorityIdx && int.TryParse(cols[priorityIdx].Trim(), out var p)) ? p : 0;
            int func = (funcIdx >= 0 && cols.Length > funcIdx && int.TryParse(cols[funcIdx].Trim(), out var f)) ? f : 0;
            int val = (valIdx >= 0 && cols.Length > valIdx && int.TryParse(cols[valIdx].Trim(), out var v)) ? v : 0;
            string pos = (posIdx >= 0 && cols.Length > posIdx) ? cols[posIdx].Trim() : "";
            string neg = (negIdx >= 0 && cols.Length > negIdx) ? cols[negIdx].Trim() : "";
            string str2 = (str2Idx >= 0 && cols.Length > str2Idx) ? cols[str2Idx].Trim() : "";

            lookup[id] = new StatCostInfo(id, statName, priority, func, val, pos, neg, str2);
        }
    }

    return lookup;
}
public static Dictionary<string, string> BuildRunewordLookup(string dir, Dictionary<string, string> stringTable)
{
    // Maps "r31,r06,r30" -> "Enigma" (rune code combo -> runeword name)
    var lookup = new Dictionary<string, string>();
    var path = Path.Combine(dir, "runes.txt");
    if (!File.Exists(path)) { return lookup; }

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

public static Dictionary<int, string> BuildUniqueItemNameLookup(string dir, Dictionary<string, string> stringTable)
{
    return BuildIndexedNameLookup(Path.Combine(dir, "uniqueitems.txt"), stringTable);
}

public static Dictionary<int, string> BuildSetItemNameLookup(string dir, Dictionary<string, string> stringTable)
{
    return BuildIndexedNameLookup(Path.Combine(dir, "setitems.txt"), stringTable);
}

public static Dictionary<string, int> BuildGemApplyTypeLookup(string dir)
{
    var lookup = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);

    foreach (var file in new[] { "armor.txt", "weapons.txt" })
    {
        var path = Path.Combine(dir, file);
        if (!File.Exists(path)) { continue; }

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

public static Dictionary<string, GemModSet> BuildGemStatsLookup(string dir)
{
    var lookup = new Dictionary<string, GemModSet>(StringComparer.OrdinalIgnoreCase);
    var path = Path.Combine(dir, "gems.txt");
    if (!File.Exists(path)) { return lookup; }

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

public static Dictionary<string, int> BuildItemLevelReqLookup(string dir)
{
    var lookup = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
    foreach (var file in new[] { "weapons.txt", "armor.txt", "misc.txt" })
    {
        var path = Path.Combine(dir, file);
        if (!File.Exists(path)) continue;
        var lines = File.ReadAllLines(path);
        if (lines.Length < 2) continue;
        var header = lines[0].Split('\t');
        int codeIdx = Array.IndexOf(header, "code");
        int reqLvlIdx = Array.IndexOf(header, "levelreq");
        if (codeIdx < 0 || reqLvlIdx < 0) continue;
        for (int i = 1; i < lines.Length; i++)
        {
            var cols = lines[i].Split('\t');
            if (cols.Length > Math.Max(codeIdx, reqLvlIdx))
            {
                var code = cols[codeIdx].Trim();
                if (!string.IsNullOrEmpty(code) && int.TryParse(cols[reqLvlIdx], out int req))
                {
                    lookup[code] = req;
                }
            }
        }
    }
    return lookup;
}

public static Dictionary<string, List<(string PropCode, string Par, int Min, int Max)>> BuildPropertyGroupsLookup(string dir)
{
    var lookup = new Dictionary<string, List<(string PropCode, string Par, int Min, int Max)>>(StringComparer.OrdinalIgnoreCase);
    var candidatePaths = new[]
    {
        Path.Combine(dir, "propertygroups.txt"),
        Path.Combine(AppContext.BaseDirectory, "propertygroups.txt"),
        Path.Combine(AppContext.BaseDirectory, "data", "excel", "propertygroups.txt"),
        Path.Combine(AppContext.BaseDirectory, "data", "propertygroups.txt"),
        "propertygroups.txt"
    };

    string? path = candidatePaths.FirstOrDefault(File.Exists);
    if (path == null) return lookup;

    var lines = File.ReadAllLines(path);
    if (lines.Length < 2) return lookup;

    var header = lines[0].Split('\t');
    int codeIdx = Array.IndexOf(header, "code");
    if (codeIdx < 0) return lookup;

    for (int i = 1; i < lines.Length; i++)
    {
        var cols = lines[i].Split('\t');
        if (cols.Length <= codeIdx) continue;
        var code = cols[codeIdx].Trim();
        if (string.IsNullOrEmpty(code)) continue;

        var list = new List<(string PropCode, string Par, int Min, int Max)>();
        for (int p = 1; p <= 8; p++)
        {
            int pIdx = Array.IndexOf(header, $"Prop{p}");
            int parIdx = Array.IndexOf(header, $"ParMin{p}");
            int minIdx = Array.IndexOf(header, $"ModMin{p}");
            int maxIdx = Array.IndexOf(header, $"ModMax{p}");
            if (pIdx < 0 || pIdx >= cols.Length) continue;
            var pCode = cols[pIdx].Trim();
            if (string.IsNullOrEmpty(pCode)) continue;
            var par = (parIdx >= 0 && parIdx < cols.Length) ? cols[parIdx].Trim() : "";
            int.TryParse((minIdx >= 0 && minIdx < cols.Length) ? cols[minIdx].Trim() : "", out var minVal);
            int.TryParse((maxIdx >= 0 && maxIdx < cols.Length) ? cols[maxIdx].Trim() : "", out var maxVal);
            list.Add((pCode, par, minVal, maxVal));
        }

        if (list.Count > 0)
            lookup[code] = list;
    }

    return lookup;
}

public static Dictionary<string, string> BuildItemTypeLookup(string dir)
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
        Console.WriteLine($"Warning: game file not found: {typesPath}"); 
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

public static Dictionary<int, string> BuildSetItemSetNameLookup(string dir, Dictionary<string, string> stringTable)
{
    var lookup = new Dictionary<int, string>();
    var path = Path.Combine(dir, "setitems.txt");
    if (!File.Exists(path)) { return lookup; }

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
            var raw = cols[setIdx].Trim();
            var setName = stringTable.TryGetValue(raw, out var loc) ? loc : raw;
            if (setName.Length > 0)
                lookup[id] = setName;
        }
    }

    return lookup;
}

public static Dictionary<string, string> BuildItemDefenseRangeLookup(string dir)
{
    var lookup = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
    var path = Path.Combine(dir, "armor.txt");
    if (!File.Exists(path)) { return lookup; }

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

public static HashSet<string> BuildQuestItemCodes(string dir)
{
    var codes = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
    foreach (var file in new[] { "armor.txt", "weapons.txt", "misc.txt" })
    {
        var path = Path.Combine(dir, file);
        if (!File.Exists(path)) continue;

        var lines = File.ReadAllLines(path);
        if (lines.Length < 2) continue;

        var header = lines[0].Split('\t');
        int codeIdx = Array.IndexOf(header, "code");
        int questIdx = Array.IndexOf(header, "quest");
        if (codeIdx < 0 || questIdx < 0) continue;

        for (int i = 1; i < lines.Length; i++)
        {
            var cols = lines[i].Split('\t');
            if (cols.Length <= Math.Max(codeIdx, questIdx)) continue;
            var code = cols[codeIdx].Trim();
            var quest = cols[questIdx].Trim();
            if (code.Length > 0 && quest.Length > 0 && quest != "0")
                codes.Add(code);
        }
    }
    return codes;
}

public static Dictionary<string, string> BuildItemTierLookup(string dir)
{
    var lookup = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

    foreach (var file in new[] { "armor.txt", "weapons.txt" })
    {
        var path = Path.Combine(dir, file);
        if (!File.Exists(path)) { continue; }

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

public static Dictionary<int, string> BuildIndexedNameLookup(string path, Dictionary<string, string> stringTable)
{
    var lookup = new Dictionary<int, string>();
    if (!File.Exists(path)) { return lookup; }

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
private static List<GemMod> ParseGemMods(string[] cols, int startIdx)
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


public static Dictionary<string, string> BuildItemNameLookup(string dir, Dictionary<string, string> stringTable)
{
    var lookup = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

    foreach (var file in new[] { "armor.txt", "weapons.txt", "misc.txt" })
    {
        var path = Path.Combine(dir, file);
        if (!File.Exists(path)) { Console.Error.WriteLine($"Warning: game file not found: {path}"); continue; }

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
                // Runes are also keyed by code + "L" (e.g. "r01L", "r22L") in item-runes.json
                var name = stringTable.TryGetValue(code, out var loc) ? loc 
                    : (stringTable.TryGetValue(code + "L", out var runeLoc) ? runeLoc : fallback);
                if (code.Length > 0 && name.Length > 0 && !lookup.ContainsKey(code))
                    lookup[code] = name;
            }
        }
    }

    return lookup;
}

public static (Dictionary<int, string> SkillNames, Dictionary<string, int> SkillNameToId) BuildSkillLookups(string dir, Dictionary<string, string> stringTable)
{
    var idToName = new Dictionary<int, string>();
    var nameToId = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
    var path = Path.Combine(dir, "skills.txt");
    if (!File.Exists(path)) { Console.Error.WriteLine($"Warning: game file not found: {path}"); return (idToName, nameToId); }

    var lines = File.ReadAllLines(path);
    if (lines.Length < 2) return (idToName, nameToId);

    var header = lines[0].Split('\t');
    int nameIdx = Array.IndexOf(header, "skill");
    int idIdx = Array.IndexOf(header, "*Id");
    if (idIdx < 0) idIdx = Array.IndexOf(header, "Id");
    int sdescIdx = Array.IndexOf(header, "skilldesc");
    if (nameIdx < 0 || idIdx < 0) return (idToName, nameToId);

    // Read skilldesc.txt to map skilldesc key to "str name" (e.g. "plague poppy" -> "Skillname223" -> "Poison Creeper")
    var skilldescPath = Path.Combine(dir, "skilldesc.txt");
    var skilldescToStrName = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
    if (File.Exists(skilldescPath))
    {
        var sdescLines = File.ReadAllLines(skilldescPath);
        if (sdescLines.Length >= 2)
        {
            var sdHeader = sdescLines[0].Split('\t');
            int sdKeyIdx = Array.IndexOf(sdHeader, "skilldesc");
            int sdStrIdx = Array.IndexOf(sdHeader, "str name");
            if (sdKeyIdx >= 0 && sdStrIdx >= 0)
            {
                for (int j = 1; j < sdescLines.Length; j++)
                {
                    var sdCols = sdescLines[j].Split('\t');
                    if (sdCols.Length > Math.Max(sdKeyIdx, sdStrIdx))
                    {
                        var k = sdCols[sdKeyIdx].Trim();
                        var v = sdCols[sdStrIdx].Trim();
                        if (k.Length > 0 && v.Length > 0 && !skilldescToStrName.ContainsKey(k))
                            skilldescToStrName[k] = v;
                    }
                }
            }
        }
    }

    for (int i = 1; i < lines.Length; i++)
    {
        var cols = lines[i].Split('\t');
        if (cols.Length > Math.Max(nameIdx, idIdx)
            && int.TryParse(cols[idIdx].Trim(), out var id))
        {
            var rawSkill = cols[nameIdx].Trim();
            string? locName = null;
            if (sdescIdx >= 0 && cols.Length > sdescIdx)
            {
                var sdescKey = cols[sdescIdx].Trim();
                if (skilldescToStrName.TryGetValue(sdescKey, out var strKey)
                    && stringTable.TryGetValue(strKey, out var loc) && loc.Trim().Length > 0)
                {
                    locName = loc.Trim();
                }
            }
            if (string.IsNullOrEmpty(locName))
            {
                if (stringTable.TryGetValue(rawSkill, out var loc) && loc.Trim().Length > 0)
                    locName = loc.Trim();
                else
                    locName = rawSkill;
            }

            if (locName.Length > 0)
                idToName[id] = locName;

            if (rawSkill.Length > 0 && !nameToId.ContainsKey(rawSkill))
                nameToId[rawSkill] = id;
            if (locName.Length > 0 && !nameToId.ContainsKey(locName))
                nameToId[locName] = id;

            // Also index normalized versions (alphanumeric only, lowercase)
            var normRaw = Regex.Replace(rawSkill, @"[^a-zA-Z0-9]", "").ToLowerInvariant();
            if (normRaw.Length > 0 && !nameToId.ContainsKey(normRaw))
                nameToId[normRaw] = id;
            var normLoc = Regex.Replace(locName, @"[^a-zA-Z0-9]", "").ToLowerInvariant();
            if (normLoc.Length > 0 && !nameToId.ContainsKey(normLoc))
                nameToId[normLoc] = id;
        }
    }

    return (idToName, nameToId);
}
public static string CleanItemName(string s)
{
    // Strip D2 color codes (0xFF or \u00ff followed by 'c' and one more char), bullets,
    // and other non-ASCII junk. Collapse whitespace.
    s = Regex.Replace(s, @"[\xff\u00ff]c.", "");
    s = Regex.Replace(s, "ÿc.", "");
    s = Regex.Replace(s, "[^\\x20-\\x7E]", "");
    s = Regex.Replace(s, "\\s+", " ");
    return s.Trim();
}
}
