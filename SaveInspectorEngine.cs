using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using D2SSharp.Data;
using D2SSharp.Enums;
using D2SSharp.Model;

namespace D2SItems;

public record GemMod(string Code, string Param, int Min, int Max);
public record GemModSet(List<GemMod> WeaponMods, List<GemMod> HelmMods, List<GemMod> ShieldMods);
public record PropertyEntry(int Func, string Stat, string Val);
public record StatCostInfo(int Id, string StatName, int DescPriority, int DescFunc, int DescVal, string DescStrPos, string DescStrNeg, string DescStr2);

public class SaveInspectorEngine
{
    public string ExcelDir { get; }
    public string CatalogRevision { get; }
    public string? StringsDir { get; }
    public object CollectionCatalog() => new {
        revision = CatalogRevision,
        categories = new[] {
            new { category = "Unique Items", names = _uniqueItemNames.Values.Distinct().Order().ToArray() },
            new { category = "Set Items", names = _setItemNames.Values.Distinct().Order().ToArray() },
            new { category = "Runewords", names = _runewordsByRunes.Values.Distinct().Order().ToArray() }
        }
    };

    public ItemDimensionsLookup ItemDimensions { get; }

    private readonly Dictionary<int, IExternalData> _externalDataCache = new();
    private readonly Dictionary<string, string> _stringTable = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<string, string> _itemNames = new();
    private readonly Dictionary<int, string> _skillNames = new();
    private readonly Dictionary<string, int> _skillNameToId = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<string, string> _runewordsByRunes = new();
    private readonly Dictionary<uint, string> _runewordIdToName = new();
    private readonly Dictionary<int, string> _uniqueItemNames = new();
    private readonly Dictionary<int, string> _setItemNames = new();
    private readonly Dictionary<string, int> _gemApplyTypes = new();
    private readonly Dictionary<string, GemModSet> _gemStats = new();
    private readonly Dictionary<string, List<PropertyEntry>> _propertyToStats = new();
    private readonly Dictionary<string, int> _statNameToId = new();
    private readonly Dictionary<int, StatCostInfo> _statCostLookup = new();
    private readonly Dictionary<string, string> _itemTiers = new();
    private readonly Dictionary<string, string> _itemTypes = new();
    private readonly Dictionary<string, int> _itemLevelReqs = new();
    private readonly Dictionary<int, string> _setItemSetNames = new();
    private readonly Dictionary<string, string> _itemDefenseRanges = new();
    private readonly HashSet<string> _questItemCodes = new(StringComparer.OrdinalIgnoreCase);
    private readonly HashSet<string> _excludedItemNames = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<int, Dictionary<(int StatId, int Layer), (int Min, int Max)>> _uniqueStatRanges = new();
    private readonly Dictionary<int, Dictionary<(int StatId, int Layer), (int Min, int Max)>> _setStatRanges = new();
    private readonly Dictionary<string, Dictionary<(int StatId, int Layer), (int Min, int Max)>> _runewordStatRanges = new();

    private readonly JsonSerializerOptions _jsonOptions = new()
    {
        WriteIndented = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping
    };

    public SaveInspectorEngine(string excelDir, string? stringsDir = null, IEnumerable<string>? excludedItems = null, string? overrideCatalogRevision = null)
    {
        ExcelDir = excelDir;
        CatalogRevision = overrideCatalogRevision ?? GameDataTables.Revision(excelDir);
        StringsDir = stringsDir;
        if (excludedItems != null)
        {
            foreach (var item in excludedItems)
                _excludedItemNames.Add(item);
        }

        BuildStringTable(excelDir, stringsDir);
        _itemNames = GameDataTables.BuildItemNameLookup(excelDir, _stringTable);
        (_skillNames, _skillNameToId) = GameDataTables.BuildSkillLookups(excelDir, _stringTable);
        _runewordsByRunes = GameDataTables.BuildRunewordLookup(excelDir, _stringTable);
        _uniqueItemNames = GameDataTables.BuildUniqueItemNameLookup(excelDir, _stringTable);
        _setItemNames = GameDataTables.BuildSetItemNameLookup(excelDir, _stringTable);
        _gemApplyTypes = GameDataTables.BuildGemApplyTypeLookup(excelDir);
        _gemStats = GameDataTables.BuildGemStatsLookup(excelDir);
        _propertyToStats = GameDataTables.BuildPropertyToStatsLookup(excelDir);
        _statNameToId = GameDataTables.BuildStatNameToIdLookup(excelDir);
        _statCostLookup = GameDataTables.BuildStatCostLookup(excelDir);
        _itemTiers = GameDataTables.BuildItemTierLookup(excelDir);
        _itemTypes = GameDataTables.BuildItemTypeLookup(excelDir);
        _itemLevelReqs = GameDataTables.BuildItemLevelReqLookup(excelDir);
        _itemLevelReqs = GameDataTables.BuildItemLevelReqLookup(excelDir);
        _setItemSetNames = GameDataTables.BuildSetItemSetNameLookup(excelDir, _stringTable);
        _itemDefenseRanges = GameDataTables.BuildItemDefenseRangeLookup(excelDir);
        _questItemCodes = GameDataTables.BuildQuestItemCodes(excelDir);
        var propGroups = GameDataTables.BuildPropertyGroupsLookup(excelDir);
        var ranges = new PropertyRangeCatalog(_propertyToStats, _statNameToId, _skillNameToId, propGroups);
        _uniqueStatRanges = ranges.BuildUniqueStatRangesLookup(excelDir);
        _setStatRanges = ranges.BuildSetStatRangesLookup(excelDir);
        _runewordStatRanges = ranges.BuildRunewordStatRangesLookup(excelDir);

        ItemDimensions = ItemDimensionsLookup.LoadFromExcel(excelDir);
    }

    public IExternalData GetExternalData(int version = 105)
    {
        if (_externalDataCache.TryGetValue(version, out var cached))
            return cached;

        var data = new TxtFileExternalData(ExcelDir, version: (uint)version);
        _externalDataCache[version] = data;
        return data;
    }

    public Dictionary<string, object> ProcessCharacterSaveData(string fileName, byte[] saveBytes)
    {
        int ver = saveBytes.Length >= 8 ? BitConverter.ToInt32(saveBytes, 4) : 105;
        IExternalData externalData = GetExternalData(ver);
        D2Save save = D2Save.Read(saveBytes, externalData);

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
            ["catalogRevision"] = CatalogRevision,
            ["saveRevision"] = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(saveBytes)),
            ["file"] = Path.GetFileName(fileName),
            ["character"] = charDict,
            ["stats"] = BuildCharStatsJson(save),
            ["items"] = allItems,
            ["mercenary"] = merc.Where(i => !IsExcludedByName(i)).Select(i => BuildItemJson(i, isMercenary: true)).ToList()
        };

        return jsonData;
    }

    public string ProcessCharacterSaveToJson(string fileName, byte[] saveBytes)
    {
        var data = ProcessCharacterSaveData(fileName, saveBytes);
        return StripNonAscii(JsonSerializer.Serialize(data, _jsonOptions));
    }

    public Dictionary<string, object> ProcessSharedStashData(string fileName, byte[] saveBytes)
    {
        int ver = saveBytes.Length >= 12 ? BitConverter.ToInt32(saveBytes, 8) : 105;
        IExternalData externalData = GetExternalData(ver);
        D2StashSave stashSave = D2StashSave.Read(saveBytes, externalData);

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

        var baseFileName = Path.GetFileNameWithoutExtension(fileName);
        var core = baseFileName.Contains("HardCore", StringComparison.OrdinalIgnoreCase) ? "hard" : "soft";
        var gameVersion = baseFileName.StartsWith("Modern", StringComparison.OrdinalIgnoreCase)
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
            ["catalogRevision"] = CatalogRevision,
            ["saveRevision"] = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(saveBytes)),
            ["file"] = Path.GetFileName(fileName),
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

        Dictionary<string, object>? chronicleData = null;
        for (int t = 0; t < stashSave.Count; t++)
        {
            var tab = stashSave[t];
            if (tab.TabType == StashTabType.Chronicle || tab.Chronicle != null)
            {
                if (tab.Chronicle != null)
                {
                    var c = tab.Chronicle;
                    chronicleData = new Dictionary<string, object>
                    {
                        ["version"] = c.Version,
                        ["uniques"] = (c.UniqueEntries ?? new List<ChronicleEntry>()).Select(e => new Dictionary<string, object>
                        {
                            ["id"] = e.ItemId,
                            ["name"] = _uniqueItemNames.TryGetValue((int)e.ItemId, out var un) ? un : $"Unique {e.ItemId}",
                            ["source"] = e.Source,
                            ["timestamp"] = e.Timestamp
                        }).ToList(),
                        ["sets"] = (c.SetEntries ?? new List<ChronicleEntry>()).Select(e => new Dictionary<string, object>
                        {
                            ["id"] = e.ItemId,
                            ["name"] = _setItemNames.TryGetValue((int)e.ItemId, out var sn) ? sn : $"Set {e.ItemId}",
                            ["source"] = e.Source,
                            ["timestamp"] = e.Timestamp
                        }).ToList(),
                        ["runewords"] = (c.RunewordEntries ?? new List<ChronicleEntry>()).Select(e => new Dictionary<string, object>
                        {
                            ["id"] = e.ItemId,
                            ["name"] = _runewordIdToName.TryGetValue(e.ItemId, out var rn) ? rn : (_stringTable.TryGetValue($"Runeword{e.ItemId}", out var rsn) ? rsn : $"Runeword {e.ItemId}"),
                            ["source"] = e.Source,
                            ["timestamp"] = e.Timestamp
                        }).ToList()
                    };
                }
                break;
            }
        }

        if (chronicleData != null)
        {
            jsonData["chronicle"] = chronicleData;
        }

        return jsonData;
    }

    public string ProcessSharedStashToJson(string fileName, byte[] saveBytes)
    {
        var data = ProcessSharedStashData(fileName, saveBytes);
        return StripNonAscii(JsonSerializer.Serialize(data, _jsonOptions));
    }

    private Dictionary<string, long> BuildCharStatsJson(D2Save save)
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

    public Dictionary<string, object?> BuildItemJson(Item item, bool isMercenary = false, bool isCorpse = false)
    {
        var tier = GetItemTier(item.ItemCodeString);
        var type = GetItemType(item.ItemCodeString);
        var setName = GetSetName(item);
        var statRanges = GetStatRangesForItem(item);
        var score = CalculatePerfectionScore(item, statRanges);
        var (w, h) = ItemDimensions.GetSize(item.ItemCodeString);
        var obj = new Dictionary<string, object?>
        {
            ["name"] = GetItemDisplayName(item),
            ["catalogRevision"] = CatalogRevision,
            ["baseName"] = GetItemName(item.ItemCodeString),
            ["itemCode"] = item.ItemCodeString.TrimEnd('\0').Trim(),
            ["itemLevel"] = item.ItemLevel,
            ["requiredLevel"] = _itemLevelReqs.TryGetValue(item.ItemCodeString.TrimEnd('\0').Trim(), out int req) ? req : (int?)null,
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
                if (sId == 368 || (_statCostLookup.TryGetValue(sId, out var sci) && (sci.StatName.Equals("corrupted", StringComparison.OrdinalIgnoreCase) || sci.StatName.Equals("item_corrupted", StringComparison.OrdinalIgnoreCase))))
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
        var unsupportedIssues = new List<string>();
        var allItemStats = new List<Dictionary<string, object>>();
        if (obj.TryGetValue("runewordStats", out var rws) && rws is List<Dictionary<string, object>> rList)
            allItemStats.AddRange(rList);
        if (obj.TryGetValue("stats", out var sts) && sts is List<Dictionary<string, object>> sList)
            allItemStats.AddRange(sList);

        foreach (var st in allItemStats)
        {
            var desc = st.GetValueOrDefault("description")?.ToString() ?? st.GetValueOrDefault("id")?.ToString() ?? "Stat";
            if (st.TryGetValue("outOfRange", out var oor))
            {
                var val = st.GetValueOrDefault("value");
                var min = st.GetValueOrDefault("expectedMin");
                var max = st.GetValueOrDefault("expectedMax");
                if (oor?.ToString() == "below_min")
                    issues.Add($"{desc} [Value: {val}] is BELOW current min {min}");
                else if (oor?.ToString() == "above_max")
                    issues.Add($"{desc} [Value: {val}] is ABOVE current max {max}");
            }
            else if (st.TryGetValue("unexpected", out var unexp) && unexp is bool b && b)
            {
                unsupportedIssues.Add($"Unsupported stat: {desc}");
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
            if (item.Sockets != null && item.Sockets.Count > 0)
                presentKeys.Add((194, 0));

            foreach (var kvp in statRanges)
            {
                if (kvp.Key.StatId == 83 && presentKeys.Any(k => k.StatId == 83))
                    continue;
                if (kvp.Key.StatId == 107 && presentKeys.Any(k => k.StatId == 107))
                    continue;

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
            obj["verificationStatus"] = "mismatch";
        }
        else if (statRanges != null && statRanges.Count > 0)
        {
            obj["isOutOfDate"] = false;
            if (unsupportedIssues.Count > 0)
            {
                obj["verificationStatus"] = "unsupported";
                obj["outOfDateIssues"] = unsupportedIssues;
            }
            else
            {
                obj["verificationStatus"] = "verified";
            }
        }
        else
        {
            obj["isOutOfDate"] = false;
            obj["verificationStatus"] = "unknown";
        }

        return obj;
    }

    public double? CalculatePerfectionScore(Item item, Dictionary<(int StatId, int Layer), (int Min, int Max)>? ranges)
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

        if (rangedCount == 0) return null;
        return Math.Round(totalPercent / rangedCount, 2);
    }

    public Dictionary<(int StatId, int Layer), (int Min, int Max)>? GetStatRangesForItem(Item item)
    {
        if (item.Quality == ItemQuality.Unique && item.QualityData is SetUniqueQualityData uqd)
        {
            _uniqueStatRanges.TryGetValue(uqd.SetUniqueFileIndex, out var ranges);
            return ranges;
        }
        if (item.Quality == ItemQuality.Set && item.QualityData is SetUniqueQualityData sqd)
        {
            _setStatRanges.TryGetValue(sqd.SetUniqueFileIndex, out var ranges);
            return ranges;
        }
        if (item.Flags.HasFlag(ItemFlags.Runeword))
        {
            var runeKey = string.Join(",", item.Sockets
                .Where(s => s != null)
                .Select(s => s!.ItemCodeString.TrimEnd('\0').Trim()));
            _runewordStatRanges.TryGetValue(runeKey, out var ranges);
            return ranges;
        }
        return null;
    }

    public Dictionary<string, object>? FormatStatJson(Stat stat, Dictionary<(int StatId, int Layer), (int Min, int Max)>? ranges)
    {
        var statIntId = (int)stat.Id;
        if (_statCostLookup.TryGetValue(statIntId, out var costInfo))
        {
            if (costInfo.DescFunc <= 0 && string.IsNullOrEmpty(costInfo.DescStrPos) && string.IsNullOrEmpty(costInfo.DescStrNeg))
            {
                return null;
            }
        }

        string idStr = stat.Id.ToString();
        if (int.TryParse(idStr, out _) && _statCostLookup.TryGetValue(statIntId, out var ci) && !string.IsNullOrEmpty(ci.StatName))
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

        if (ranges != null)
        {
            if (ranges.TryGetValue(((int)stat.Id, stat.Layer), out var range))
            {
                obj["range"] = $"{range.Min}-{range.Max}";
                obj["expectedMin"] = range.Min;
                obj["expectedMax"] = range.Max;
                if (value < range.Min)
                    obj["outOfRange"] = "below_min";
                else if (value > range.Max)
                    obj["outOfRange"] = "above_max";
            }
            else
            {
                obj["unexpected"] = true;
            }
        }

        return obj;
    }

    public string GetItemDisplayName(Item item)
    {
        var baseName = GetItemName(item.ItemCodeString);

        if (item.Flags.HasFlag(ItemFlags.Runeword))
        {
            var rwName = GetRunewordNameFromSockets(item);
            return $"{rwName} ({baseName})";
        }

        if (item.Quality == ItemQuality.Unique && item.QualityData is SetUniqueQualityData uqd)
        {
            if (_uniqueItemNames.TryGetValue(uqd.SetUniqueFileIndex, out var uName))
                return $"{uName} ({baseName})";
        }

        if (item.Quality == ItemQuality.Set && item.QualityData is SetUniqueQualityData sqd)
        {
            if (_setItemNames.TryGetValue(sqd.SetUniqueFileIndex, out var sName))
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

    public string GetRunewordNameFromSockets(Item item)
    {
        var runeKey = string.Join(",", item.Sockets
            .Where(s => s != null)
            .Select(s => s!.ItemCodeString.TrimEnd('\0').Trim()));

        if (_runewordsByRunes.TryGetValue(runeKey, out var rwName))
            return rwName;

        return "Unknown Runeword";
    }

    public static string FormatEquippedLocation(BodyLocation loc) => loc switch
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

    public string GetLocationString(Item item, bool isMercenary = false, bool isCorpse = false)
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

    public string GetItemName(string code)
    {
        var trimmed = code.TrimEnd('\0').Trim();
        if (_itemNames.TryGetValue(trimmed, out var name))
            return name;
        return trimmed;
    }

    public string? GetItemTier(string code)
    {
        var trimmed = code.TrimEnd('\0').Trim();
        if (_itemTiers.TryGetValue(trimmed, out var tier))
            return tier;
        return null;
    }

    public string? GetItemType(string code)
    {
        var trimmed = code.TrimEnd('\0').Trim();
        if (_itemTypes.TryGetValue(trimmed, out var type))
            return type;
        return null;
    }

    public string? GetBaseDefenseRange(string code)
    {
        var trimmed = code.TrimEnd('\0').Trim();
        if (_itemDefenseRanges.TryGetValue(trimmed, out var range))
            return range;
        return null;
    }

    public (int Min, int Max)? GetEffectiveDefenseRange(Item item, Dictionary<(int StatId, int Layer), (int Min, int Max)>? statRanges)
    {
        var baseRangeStr = GetBaseDefenseRange(item.ItemCodeString);
        if (baseRangeStr == null) return null;
        var parts = baseRangeStr.Split('-');
        if (parts.Length != 2 || !int.TryParse(parts[0], out var baseMin) || !int.TryParse(parts[1], out var baseMax))
            return null;

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

    public string? GetSetName(Item item)
    {
        if (item.Quality == ItemQuality.Set && item.QualityData is SetUniqueQualityData sqd)
        {
            if (_setItemSetNames.TryGetValue(sqd.SetUniqueFileIndex, out var setName))
                return setName;
        }
        return null;
    }

    public bool IsExcludedByName(Item item)
    {
        if (_excludedItemNames.Count == 0) return false;
        var displayName = GetItemDisplayName(item);
        if (_excludedItemNames.Contains(displayName)) return true;
        var parenIdx = displayName.IndexOf('(');
        if (parenIdx > 0 && _excludedItemNames.Contains(displayName[..parenIdx].Trim())) return true;
        var baseName = GetItemName(item.ItemCodeString);
        if (_excludedItemNames.Contains(baseName)) return true;
        return false;
    }

    public bool IsQuestItem(Item item)
    {
        var code = item.ItemCodeString.TrimEnd('\0').Trim();
        return _questItemCodes.Contains(code);
    }

    public string FormatStat(Stat stat)
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

        if (_statCostLookup.TryGetValue(statIntId, out var info))
        {
            if (info.DescFunc == 3)
            {
                var strKey = !string.IsNullOrEmpty(info.DescStrPos) ? info.DescStrPos : info.DescStrNeg;
                if (!string.IsNullOrEmpty(strKey) && _stringTable.TryGetValue(strKey, out var localized) && !string.IsNullOrWhiteSpace(localized))
                    return localized;
                if (!string.IsNullOrEmpty(info.StatName))
                    return FormatRawStatName(info.StatName);
            }

            var keyToUse = value >= 0 ? info.DescStrPos : (string.IsNullOrEmpty(info.DescStrNeg) ? info.DescStrPos : info.DescStrNeg);
            if (!string.IsNullOrEmpty(keyToUse) && _stringTable.TryGetValue(keyToUse, out var localizedStr) && !string.IsNullOrWhiteSpace(localizedStr))
            {
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

                if (info.DescFunc is 15 or 20)
                    return localizedStr;

                if (info.DescVal == 1)
                    return $"{(value >= 0 ? "+" : "")}{value} {localizedStr}";

                if (info.DescVal == 2)
                    return $"{localizedStr}: {(value >= 0 ? "+" : "")}{value}";

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

    private string FormatStatKeyDescription(int statId, int layer, (int Min, int Max) range)
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

        if (statId == 194)
        {
            return $"Sockets ({rangeStr})";
        }

        if (statId == 252)
        {
            return $"Repairs 1 durability in {rangeStr} seconds";
        }

        if (statId == 253)
        {
            return $"Replenishes quantity (1 in {rangeStr} seconds)";
        }

        if (IsPerLevelStat(statIdEnum))
        {
            var desc = GetPerLevelDescription(statIdEnum);
            var perLvlVal = (range.Min == range.Max) ? $"{range.Min / 8.0:0.###}" : $"{range.Min / 8.0:0.###}-{range.Max / 8.0:0.###}";
            return $"+{perLvlVal} to {desc} (per level)";
        }

        if (statId == 204 || statIdEnum == StatId.ItemChargedSkill)
        {
            int skillLevel = layer & 0x3F;
            int skillId = layer >> 6;
            var skillName = GetSkillName(StatId.SingleSkill, skillId);
            return $"Level {skillLevel} {skillName} ({rangeStr} Charges)";
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

        if (statId is 48 or 49) return $"Adds {rangeStr} Fire Damage";
        if (statId is 50 or 51) return $"Adds {rangeStr} Lightning Damage";
        if (statId is 52 or 53) return $"Adds {rangeStr} Magic Damage";
        if (statId is 54 or 55) return $"Adds {rangeStr} Cold Damage";
        if (statId == 56) return $"Cold Duration: {rangeStr} frames ({range.Max / 25.0:0.#}s)";
        if (statId is 57 or 58) return $"Adds {rangeStr} Poison Damage";
        if (statId == 59) return $"Poison Duration: {rangeStr} frames ({range.Max / 25.0:0.#}s)";
        if (statId is 21 or 22) return $"Adds {rangeStr} Damage";

        if (_statCostLookup.TryGetValue(statId, out var costInfo) && costInfo.StatName.Equals("item_elemskill", StringComparison.OrdinalIgnoreCase))
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

    private string FormatStatName(StatId id)
    {
        int statIntId = (int)id;
        if (_statCostLookup.TryGetValue(statIntId, out var info))
        {
            var keyToUse = !string.IsNullOrEmpty(info.DescStrPos) ? info.DescStrPos : info.DescStrNeg;
            if (!string.IsNullOrEmpty(keyToUse) && _stringTable.TryGetValue(keyToUse, out var localized) && !string.IsNullOrWhiteSpace(localized))
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

    private string FormatRawStatName(string name)
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

    private static bool IsPerLevelStat(StatId id) => id is
        StatId.StrengthPerLevel or StatId.DexterityPerLevel or StatId.VitalityPerLevel or
        StatId.EnergyPerLevel or StatId.LifePerLevel or StatId.ManaPerLevel or
        StatId.ArmorPerLevel or StatId.MagicFindPerLevel or StatId.FindGoldPerLevel or
        StatId.AttackRatingPerLevel or StatId.MaxDamagePerLevel or StatId.MaxDamagePercentPerLevel;

    private static string GetPerLevelDescription(StatId id) => id switch
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

    private static bool IsSkillStat(StatId id) => id is
        StatId.NonClassSkill or StatId.SingleSkill or StatId.AddSkillTab or
        StatId.AddClassSkills or StatId.Aura;

    private string GetSkillName(StatId statType, int id)
    {
        if (statType == StatId.Aura)
            return _skillNames.TryGetValue(id, out var auraName) ? auraName : $"Aura #{id}";

        if (statType == StatId.AddSkillTab)
        {
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

        if (_skillNames.TryGetValue(id, out var skillName))
            return skillName;

        return $"Skill #{id}";
    }

    private static bool IsSignedStat(StatId id) => id is
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

    private static bool IsPercentStat(StatId id) => id is
        StatId.FasterRunWalk or StatId.FasterHitRecovery or StatId.FasterBlockRate or
        StatId.FasterCastRate or StatId.IncreasedAttackSpeed or
        StatId.MagicFind or StatId.GoldFind or
        StatId.CrushingBlow or StatId.OpenWounds or StatId.DeadlyStrike or
        StatId.MaxDamagePercent or StatId.MinDamagePercent or
        StatId.LifeSteal or StatId.ManaSteal or
        StatId.DamageReduced;

    private List<string> GetSocketStats(Item item)
    {
        var lines = new List<string>();
        if (item.Sockets.Count == 0) return lines;

        var parentCode = item.ItemCodeString.TrimEnd('\0').Trim();
        int applyType = 1;
        if (_gemApplyTypes.TryGetValue(parentCode, out var gat))
            applyType = gat;

        foreach (var socket in item.Sockets)
        {
            if (socket == null) continue;
            var socketCode = socket.ItemCodeString.TrimEnd('\0').Trim();

            if (socket.Stats?.Count > 0)
            {
                foreach (var stat in socket.Stats)
                    lines.Add($"{FormatStat(stat)} ({GetItemName(socketCode)})");
            }

            if (_gemStats.TryGetValue(socketCode, out var mods))
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

    private static string NormalizePropertyCode(string propCode)
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

    private string? ResolvePropertyToText(string propCode, string param, int min, int max)
    {
        if (string.IsNullOrEmpty(propCode)) return null;

        var normCode = NormalizePropertyCode(propCode);
        if (!_propertyToStats.TryGetValue(normCode, out var propEntries) && !_propertyToStats.TryGetValue(propCode, out propEntries))
            return $"{propCode}: {min}-{max}";

        var parts = new List<string>();
        foreach (var entry in propEntries)
        {
            var statId = -1;
            if (!string.IsNullOrEmpty(entry.Stat) && _statNameToId.TryGetValue(entry.Stat, out var sid))
                statId = sid;

            var value = (min == max) ? $"{min}" : $"{min}-{max}";

            switch (entry.Func)
            {
                case 1:
                case 3:
                case 8:
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
                case 5:
                    parts.Add($"Min Damage: +{value}");
                    break;
                case 6:
                    parts.Add($"Max Damage: +{value}");
                    break;
                case 7:
                    parts.Add($"Enhanced Damage: +{value}%");
                    break;
                case 10:
                    if (int.TryParse(param, out var tabId))
                    {
                        int saveLayer = (tabId / 3) * 8 + (tabId % 3);
                        parts.Add($"+{value} to {GetSkillName(StatId.AddSkillTab, saveLayer)}");
                    }
                    else
                        parts.Add($"+{value} to Skill Tab {param}");
                    break;
                case 15:
                case 16:
                    if (statId >= 0)
                        parts.Add($"{FormatStatName((StatId)statId)}: +{value}");
                    break;
                case 22:
                    int skillId = -1;
                    if (int.TryParse(param, out var pid)) skillId = pid;
                    else if (_skillNameToId.TryGetValue(param, out var sId)) skillId = sId;
                    else
                    {
                        var clean = Regex.Replace(param, @"[^a-zA-Z0-9]", "").ToLowerInvariant();
                        if (_skillNameToId.TryGetValue(clean, out var cId)) skillId = cId;
                    }
                    var sName = _skillNames.TryGetValue(skillId, out var sn) ? sn : $"Skill {param}";
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

    private void BuildStringTable(string dir, string? customStringsDir)
    {
        var candidateDirs = new List<string>();
        if (!string.IsNullOrEmpty(customStringsDir) && Directory.Exists(customStringsDir))
            candidateDirs.Add(customStringsDir);

        var relStrings = Path.GetFullPath(Path.Combine(dir, "..", "..", "local", "lng", "strings"));
        if (Directory.Exists(relStrings)) candidateDirs.Add(relStrings);

        var relLegacy = Path.GetFullPath(Path.Combine(dir, "..", "..", "local", "lng", "strings-legacy"));
        if (Directory.Exists(relLegacy)) candidateDirs.Add(relLegacy);

        var stringFiles = new[]
        {
            "item-names.json",
            "item-runes.json",
            "item-modifiers.json",
            "item-nameaffixes.json",
            "skills.json",
            "ui.json"
        };

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
                        {
                            var clean = GameDataTables.CleanItemName(en);
                            _stringTable[key] = clean;
                            if (entry.TryGetProperty("id", out var idEl) && (file.Contains("runes") || key.StartsWith("Runeword", StringComparison.OrdinalIgnoreCase)))
                            {
                                _runewordIdToName[idEl.GetUInt32()] = clean;
                            }
                        }
                    }
                }
                catch { /* skip on parse error */ }
            }
        }
    }









    private static string CleanRunewordName(string raw)
    {
        if (raw.StartsWith("Runeword", StringComparison.OrdinalIgnoreCase))
            return raw;
        return Regex.Replace(raw, "(?<=[a-z])(?=[A-Z])", " ");
    }



























    public List<Dictionary<string, object>> ExportUniqueItemsCatalog()
    {
        var result = new List<Dictionary<string, object>>();
        var path = Path.Combine(ExcelDir, "uniqueitems.txt");
        if (!File.Exists(path)) return result;

        var lines = File.ReadAllLines(path);
        if (lines.Length < 2) return result;

        var header = lines[0].Split('\t');
        int idIdx = Array.IndexOf(header, "*ID");
        int indexIdx = Array.IndexOf(header, "index");
        int codeIdx = Array.IndexOf(header, "code");
        int enabledIdx = Array.IndexOf(header, "enabled");
        int lvlIdx = Array.IndexOf(header, "lvl");
        int reqLvlIdx = Array.IndexOf(header, "lvl req");
        int invFileIdx = Array.IndexOf(header, "invfile");

        for (int i = 1; i < lines.Length; i++)
        {
            var line = lines[i];
            if (string.IsNullOrWhiteSpace(line)) continue;
            var cols = line.Split('\t');
            if (cols.Length <= Math.Max(idIdx, Math.Max(indexIdx, codeIdx))) continue;

            if (!int.TryParse(cols[idIdx].Trim(), out int id)) continue;
            if (enabledIdx >= 0 && cols.Length > enabledIdx && cols[enabledIdx].Trim() == "0") continue;

            var index = cols[indexIdx].Trim();
            if (string.IsNullOrEmpty(index)) continue;
            var code = cols[codeIdx].Trim();
            if (string.IsNullOrEmpty(code)) continue;

            var displayName = _uniqueItemNames.TryGetValue(id, out var uName) && !string.IsNullOrEmpty(uName)
                ? uName
                : (_stringTable.TryGetValue(index, out var sName) && !string.IsNullOrEmpty(sName) ? sName : index);

            int lvl = lvlIdx >= 0 && cols.Length > lvlIdx && int.TryParse(cols[lvlIdx].Trim(), out int parsedLvl) ? parsedLvl : 1;
            int reqLvl = reqLvlIdx >= 0 && cols.Length > reqLvlIdx && int.TryParse(cols[reqLvlIdx].Trim(), out int parsedReq) ? parsedReq : 1;
            var invFile = invFileIdx >= 0 && cols.Length > invFileIdx ? cols[invFileIdx].Trim() : "";

            var baseName = GetItemName(code);
            var (w, h) = ItemDimensions.GetSize(code);

            var statsList = new List<Dictionary<string, object>>();
            if (_uniqueStatRanges.TryGetValue(id, out var ranges))
            {
                foreach (var kvp in ranges)
                {
                    var (statId, layer) = kvp.Key;
                    var (min, max) = kvp.Value;
                    var desc = FormatStatKeyDescription(statId, layer, (min, max));
                    var statName = FormatStatName((StatId)statId);

                    statsList.Add(new Dictionary<string, object>
                    {
                        ["statId"] = statId,
                        ["layer"] = layer,
                        ["name"] = statName,
                        ["desc"] = desc,
                        ["min"] = min,
                        ["max"] = max,
                        ["defaultValue"] = max,
                        ["isFixed"] = min == max
                    });
                }
            }

            result.Add(new Dictionary<string, object>
            {
                ["id"] = id,
                ["name"] = displayName,
                ["code"] = code,
                ["baseName"] = baseName,
                ["lvl"] = lvl,
                ["lvlReq"] = reqLvl,
                ["invFile"] = invFile,
                ["width"] = w,
                ["height"] = h,
                ["stats"] = statsList
            });
        }

        result.Sort((a, b) => string.Compare((string)a["name"], (string)b["name"], StringComparison.OrdinalIgnoreCase));
        return result;
    }

    private static string StripNonAscii(string input)
    {
        return Regex.Replace(input, @"[^\x00-\x7F]", "");
    }
}
