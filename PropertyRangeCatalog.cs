using System.Text.RegularExpressions;
namespace D2SItems;

// Header-based TXT lookup shared by CLI and WASM. Property function/layer semantics
// follow the mod tables, consistent with BT-BKDiff's PropertyResolverService.
public sealed class PropertyRangeCatalog(
    Dictionary<string, List<PropertyEntry>> propertyToStats,
    Dictionary<string, int> statNameToId,
    Dictionary<string, int> skillNameToId,
    Dictionary<string, List<(string PropCode, string Par, int Min, int Max)>>? propertyGroups = null)
{
    private Dictionary<string, List<(string PropCode, string Par, int Min, int Max)>>? _propertyGroups = propertyGroups;

List<((int StatId, int Layer) Key, (int Min, int Max) Range)> ResolvePropertyToRanges(string propCode, string param, int min, int max)
{
    var result = new List<((int StatId, int Layer) Key, (int Min, int Max) Range)>();
    if (string.IsNullOrEmpty(propCode) || propCode.StartsWith("*")) return result;

    var normCode = NormalizePropertyCode(propCode);

    // Hardcoded special engine property funcs without stat column
    if (normCode.Equals("dmg-min", StringComparison.OrdinalIgnoreCase)) { result.Add(((21, 0), (min, max))); return result; }
    if (normCode.Equals("dmg-max", StringComparison.OrdinalIgnoreCase)) { result.Add(((22, 0), (min, max))); return result; }
    if (normCode.Equals("dmg%", StringComparison.OrdinalIgnoreCase))
    {
        // func 7: sets both item_maxdamage_percent (17) and item_mindamage_percent (18)
        result.Add(((17, 0), (min, max)));
        result.Add(((18, 0), (min, max)));
        return result;
    }
    if (normCode.Equals("indestruct", StringComparison.OrdinalIgnoreCase)) { result.Add(((152, 0), (min, max))); return result; }

    // Check property groups (e.g. skilltab-war, magdam-rand, sunder charm affixes)
    if (_propertyGroups != null && (_propertyGroups.TryGetValue(normCode, out var groupProps) || _propertyGroups.TryGetValue(propCode, out groupProps)))
    {
        foreach (var sub in groupProps)
        {
            result.AddRange(ResolvePropertyToRanges(sub.PropCode, sub.Par, sub.Min, sub.Max));
        }
        return result;
    }

    if (!propertyToStats.TryGetValue(normCode, out var entries) && !propertyToStats.TryGetValue(propCode, out entries))
        return result;

    // Check if this property has specific item_elemskill_{elem} stats alongside generic item_elemskill
    bool hasSpecificElemSkill = entries.Any(e => e.Stat.StartsWith("item_elemskill_", StringComparison.OrdinalIgnoreCase));

    foreach (var entry in entries)
    {
        if (string.IsNullOrEmpty(entry.Stat)) continue;

        // If the mod defined specific item_elemskill_cold/fire/etc., skip the generic item_elemskill
        if (hasSpecificElemSkill && entry.Stat.Equals("item_elemskill", StringComparison.OrdinalIgnoreCase))
            continue;

        if (!statNameToId.TryGetValue(entry.Stat, out var statId)) continue;

        int effMin = min;
        int effMax = max;
        int layer = 0;

        // 1. Chance-to-cast skills (func 11)
        if (entry.Func == 11)
        {
            int skillId = 0;
            var pToLookup = !string.IsNullOrEmpty(param) ? param : entry.Val;
            if (!string.IsNullOrEmpty(pToLookup))
            {
                if (int.TryParse(pToLookup, out var directId))
                    skillId = directId;
                else if (skillNameToId.TryGetValue(pToLookup, out var sId))
                    skillId = sId;
                else
                {
                    var clean = Regex.Replace(pToLookup, @"[^a-zA-Z0-9]", "").ToLowerInvariant();
                    if (skillNameToId.TryGetValue(clean, out var cId))
                        skillId = cId;
                }
            }

            int skillLevel = max > 0 ? max : (min > 0 ? min : 1);
            int chance = min > 0 ? min : (max > 0 ? max : 1);
            layer = (skillId << 6) | (skillLevel & 0x3F);
            result.Add(((statId, layer), (chance, chance)));
            continue;
        }

        // 2. Sockets (func 14)
        if (entry.Func == 14)
        {
            effMin = min > 0 ? min : 1;
            effMax = max > 0 ? max : effMin;
            result.Add(((statId, 0), (effMin, effMax)));
            continue;
        }

        // 3. Min damage (func 15)
        if (entry.Func == 15)
        {
            result.Add(((statId, 0), (min, min)));
            continue;
        }

        // 4. Max damage (func 16)
        if (entry.Func == 16)
        {
            result.Add(((statId, 0), (max, max)));
            continue;
        }

        // 5. Per-level stats & durations & replenishments (func 17)
        if (entry.Func == 17)
        {
            effMin = min;
            effMax = max;
            if (entry.Stat.Equals("poisonlength", StringComparison.OrdinalIgnoreCase) ||
                entry.Stat.Equals("coldlength", StringComparison.OrdinalIgnoreCase))
            {
                if (int.TryParse(param, out var pDuration) && pDuration > 0)
                {
                    effMin = pDuration;
                    effMax = pDuration;
                }
            }
            else if (effMin == 0 && effMax == 0 && int.TryParse(param, out var pVal))
            {
                effMin = pVal;
                effMax = pVal;
            }
            else if (effMax == 0 && effMin > 0)
            {
                effMax = effMin;
            }
            if (effMin != 0 || effMax != 0)
            {
                result.Add(((statId, 0), (effMin, effMax)));
            }
            continue;
        }

        // 6. Charged skills (func 19)
        if (entry.Func == 19)
        {
            int skillId = 0;
            var pToLookup = !string.IsNullOrEmpty(param) ? param : entry.Val;
            if (!string.IsNullOrEmpty(pToLookup))
            {
                if (int.TryParse(pToLookup, out var directId))
                    skillId = directId;
                else if (skillNameToId.TryGetValue(pToLookup, out var sId))
                    skillId = sId;
                else
                {
                    var clean = Regex.Replace(pToLookup, @"[^a-zA-Z0-9]", "").ToLowerInvariant();
                    if (skillNameToId.TryGetValue(clean, out var cId))
                        skillId = cId;
                }
            }

            int skillLevel = min > 0 ? min : 1;
            int maxCharges = max > 0 ? max : 1;
            layer = (skillId << 6) | (skillLevel & 0x3F);
            result.Add(((statId, layer), (maxCharges, maxCharges)));
            continue;
        }

        // 7. Random skill (func 12, e.g. Ormus)
        if (entry.Func == 12)
        {
            int bonus = int.TryParse(param, out var bVal) ? bVal : (max > 0 ? max : 1);
            int skillId = min > 0 ? min : 36;
            result.Add(((statId, skillId), (bonus, bonus)));
            continue;
        }

        // 8. Random class skill (func 36, e.g. Hellfire Torch)
        if (entry.Func == 36)
        {
            int bonus = int.TryParse(entry.Val, out var bVal) ? bVal : (max > 0 ? max : 1);
            result.Add(((statId, 0), (bonus, bonus)));
            continue;
        }

        // Fix column-shift typos in mod files (e.g. Yang ring has mana-kill par=5 min=20 max=empty, Guardian Angel has dmg-ac par=100 min=empty max=empty)
        if (effMin == 0 && effMax == 0 && int.TryParse(param, out var emptyVal) && emptyVal != 0)
        {
            if (normCode.Equals("dmg-ac", StringComparison.OrdinalIgnoreCase))
            {
                effMin = -Math.Abs(emptyVal);
                effMax = -Math.Abs(emptyVal);
            }
            else
            {
                effMin = emptyVal;
                effMax = emptyVal;
            }
        }
        else if (effMax == 0 && effMin > 0)
        {
            if (entry.Func is 1 or 3 or 8 && int.TryParse(param, out var pVal) && pVal > 0)
            {
                effMax = effMin;
                effMin = pVal;
            }
            else
            {
                effMax = effMin;
            }
        }

        if (entry.Func == 21) // class skills (ama, sor, nec, pal, bar, dru, ass, war) or elem skill
        {
            if (int.TryParse(entry.Val, out var valNum))
                layer = valNum;
            else if (!string.IsNullOrEmpty(param))
            {
                layer = param.ToLowerInvariant() switch
                {
                    "ama" or "amazon" => 0,
                    "sor" or "sorceress" => 1,
                    "nec" or "necromancer" => 2,
                    "pal" or "paladin" => 3,
                    "bar" or "barbarian" => 4,
                    "dru" or "druid" => 5,
                    "ass" or "assassin" => 6,
                    "war" or "warlock" => 7,
                    _ => int.TryParse(param, out var pN) ? pN : 0
                };
            }
        }
        else if (entry.Func == 10) // skilltab
        {
            // Tab index can be in entry.Val or in param
            int tabIdx = -1;
            if (int.TryParse(entry.Val, out var vTab))
                tabIdx = vTab;
            else if (int.TryParse(param, out var pTab))
                tabIdx = pTab;

            if (tabIdx >= 0)
            {
                // In D2 save files, AddSkillTab layer = (tabIdx / 3) * 8 + (tabIdx % 3)
                layer = (tabIdx / 3) * 8 + (tabIdx % 3);
            }
        }
        else if (entry.Func == 22) // oskill, skill, aura
        {
            var pToLookup = !string.IsNullOrEmpty(param) ? param : entry.Val;
            if (!string.IsNullOrEmpty(pToLookup))
            {
                if (int.TryParse(pToLookup, out var directId))
                    layer = directId;
                else if (skillNameToId.TryGetValue(pToLookup, out var sId))
                    layer = sId;
                else
                {
                    var clean = Regex.Replace(pToLookup, @"[^a-zA-Z0-9]", "").ToLowerInvariant();
                    if (skillNameToId.TryGetValue(clean, out var cId))
                        layer = cId;
                }
            }
        }
        else if (entry.Func == 24) // monster damage, state, reanimate, etc.
        {
            if (int.TryParse(param, out var pN)) layer = pN;
            else if (int.TryParse(entry.Val, out var vN)) layer = vN;
        }
        else
        {
            if (int.TryParse(param, out var pN)) layer = pN;
            else if (int.TryParse(entry.Val, out var vN)) layer = vN;
        }

        result.Add(((statId, layer), (effMin, effMax)));
    }

    return result;
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

        var list = ResolvePropertyToRanges(propCode, param, min, max);
        foreach (var item in list)
        {
            // Item stat lists merge identical (stat, layer) entries by summing (e.g. two swing2 props).
            if (ranges.TryGetValue(item.Key, out var existing))
                ranges[item.Key] = (existing.Min + item.Range.Min, existing.Max + item.Range.Max);
            else
                ranges[item.Key] = item.Range;
        }
    }
    return ranges;
}

public Dictionary<int, Dictionary<(int StatId, int Layer), (int Min, int Max)>> BuildUniqueStatRangesLookup(string dir)
{
    var lookup = new Dictionary<int, Dictionary<(int StatId, int Layer), (int Min, int Max)>>();
    var path = Path.Combine(dir, "uniqueitems.txt");
    if (!File.Exists(path)) return lookup;

    if (_propertyGroups == null)
        _propertyGroups = GameDataTables.BuildPropertyGroupsLookup(dir);

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

public Dictionary<int, Dictionary<(int StatId, int Layer), (int Min, int Max)>> BuildSetStatRangesLookup(string dir)
{
    var lookup = new Dictionary<int, Dictionary<(int StatId, int Layer), (int Min, int Max)>>();
    var path = Path.Combine(dir, "setitems.txt");
    if (!File.Exists(path)) return lookup;

    if (_propertyGroups == null)
        _propertyGroups = GameDataTables.BuildPropertyGroupsLookup(dir);

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

public Dictionary<string, Dictionary<(int StatId, int Layer), (int Min, int Max)>> BuildRunewordStatRangesLookup(string dir)
{
    // Keyed by rune combo string like "r31,r06,r30"
    var lookup = new Dictionary<string, Dictionary<(int StatId, int Layer), (int Min, int Max)>>();
    var path = Path.Combine(dir, "runes.txt");
    if (!File.Exists(path)) return lookup;

    if (_propertyGroups == null)
        _propertyGroups = GameDataTables.BuildPropertyGroupsLookup(dir);

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

string NormalizePropertyCode(string propCode)
{
    if (string.IsNullOrEmpty(propCode)) return "";
    return propCode.Trim().ToLowerInvariant() switch
    {
        "cast" => "cast1",
        "balance" => "balance1",
        "move" => "move1",
        "swing" => "swing1",
        "cold-res" => "res-cold",
        "fire-res" => "res-fire",
        "ltng-res" => "res-ltng",
        "pois-res" => "res-pois",
        "all-res" => "res-all",
        "ern%" => "enr%",
        "res-poi-len" => "res-pois-len",
        "get-hit-skill" => "gethit-skill",
        "hitskill" => "hit-skill",
        "attskill" => "att-skill",
        "level-skill" => "levelup-skill",
        "ar%" => "att%",
        _ => propCode.Trim()
    };
}
}
