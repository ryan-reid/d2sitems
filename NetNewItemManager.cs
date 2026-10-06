using System.Text.Json;
using D2SSharp.Data;
using D2SSharp.Enums;
using D2SSharp.Model;

namespace D2SItems;

public sealed class NetNewItemStat
{
    public StatId Id { get; set; }
    public int StatId
    {
        get => (int)Id;
        set => Id = (StatId)value;
    }
    public int Layer { get; set; }
    public long Value { get; set; }
}

/// <summary>
/// Creates a single valid, serialized item for a character or stash save.
/// Authoritative BKDiablo definitions and ranges are enforced on the backend.
/// </summary>
public sealed class NetNewItemRequest
{
    public string ItemCode { get; set; } = "";
    public ItemQuality Quality { get; set; } = ItemQuality.Normal;
    public ushort? QualityIndex { get; set; }
    public uint Seed { get; set; }
    public byte ItemLevel { get; set; } = 1;
    public int X { get; set; } = -1;
    public int Y { get; set; } = -1;
    public int TabIndex { get; set; } = 0;
    public bool IsEthereal { get; set; }
    public bool? Ethereal { get; set; }
    public List<NetNewItemStat>? ItemStats { get; set; }
    public Dictionary<StatId, long> Stats { get; set; } = new();
    public Dictionary<StatId, StatRange> AllowedRanges { get; set; } = new();
}

public sealed class StatRange
{
    public long Min { get; set; }
    public long Max { get; set; }
}

public static class NetNewItemManager
{
    private static Dictionary<int, Dictionary<(int StatId, int Layer), (int Min, int Max)>>? _cachedUniqueRanges;
    private static readonly object _rangesLock = new();

    private sealed record BaseItemProps(ushort? Defense, byte? Durability, byte? MaxDurability, ushort? Quantity);
    private static Dictionary<string, BaseItemProps>? _cachedBaseProps;
    private static readonly object _propsLock = new();

    private static BaseItemProps GetBaseItemProps(string itemCode, string excelDir)
    {
        lock (_propsLock)
        {
            if (_cachedBaseProps != null && _cachedBaseProps.TryGetValue(itemCode.Trim(), out var cached))
                return cached;

            var lookup = _cachedBaseProps ?? new Dictionary<string, BaseItemProps>(StringComparer.OrdinalIgnoreCase);

            if (_cachedBaseProps == null)
            {
                // 1. Load armor.txt
                var armorPath = Path.Combine(excelDir, "armor.txt");
                if (File.Exists(armorPath))
                {
                    var lines = File.ReadAllLines(armorPath);
                    if (lines.Length > 1)
                    {
                        var header = lines[0].Split('\t');
                        int codeIdx = Array.IndexOf(header, "code");
                        int minIdx = Array.IndexOf(header, "minac");
                        int maxIdx = Array.IndexOf(header, "maxac");
                        int durIdx = Array.IndexOf(header, "durability");
                        int nodurIdx = Array.IndexOf(header, "nodurability");

                        for (int i = 1; i < lines.Length; i++)
                        {
                            var cols = lines[i].Split('\t');
                            if (cols.Length <= codeIdx) continue;
                            var code = cols[codeIdx].Trim();
                            if (code.Length == 0) continue;

                            ushort def = 0;
                            if (maxIdx >= 0 && cols.Length > maxIdx && int.TryParse(cols[maxIdx].Trim(), out var maxAc) && maxAc > 0)
                                def = (ushort)maxAc;
                            else if (minIdx >= 0 && cols.Length > minIdx && int.TryParse(cols[minIdx].Trim(), out var minAc) && minAc > 0)
                                def = (ushort)minAc;

                            byte? dur = null;
                            bool noDur = nodurIdx >= 0 && cols.Length > nodurIdx && cols[nodurIdx].Trim() == "1";
                            if (!noDur && durIdx >= 0 && cols.Length > durIdx && int.TryParse(cols[durIdx].Trim(), out var durVal) && durVal > 0)
                                dur = (byte)Math.Min(255, durVal);

                            lookup[code] = new BaseItemProps(def > 0 ? def : (ushort)1, dur, dur, null);
                        }
                    }
                }

                // 2. Load weapons.txt
                var weaponsPath = Path.Combine(excelDir, "weapons.txt");
                if (File.Exists(weaponsPath))
                {
                    var lines = File.ReadAllLines(weaponsPath);
                    if (lines.Length > 1)
                    {
                        var header = lines[0].Split('\t');
                        int codeIdx = Array.IndexOf(header, "code");
                        int durIdx = Array.IndexOf(header, "durability");
                        int nodurIdx = Array.IndexOf(header, "nodurability");
                        int stackIdx = Array.IndexOf(header, "stackable");
                        int maxStackIdx = Array.IndexOf(header, "maxstack");

                        for (int i = 1; i < lines.Length; i++)
                        {
                            var cols = lines[i].Split('\t');
                            if (cols.Length <= codeIdx) continue;
                            var code = cols[codeIdx].Trim();
                            if (code.Length == 0) continue;

                            bool isStack = stackIdx >= 0 && cols.Length > stackIdx && cols[stackIdx].Trim() == "1";
                            ushort? qty = null;
                            if (isStack)
                            {
                                if (maxStackIdx >= 0 && cols.Length > maxStackIdx && int.TryParse(cols[maxStackIdx].Trim(), out var ms) && ms > 0)
                                    qty = (ushort)ms;
                                else
                                    qty = 1;
                            }

                            byte? dur = null;
                            bool noDur = nodurIdx >= 0 && cols.Length > nodurIdx && cols[nodurIdx].Trim() == "1";
                            if (!noDur && !isStack && durIdx >= 0 && cols.Length > durIdx && int.TryParse(cols[durIdx].Trim(), out var durVal) && durVal > 0)
                                dur = (byte)Math.Min(255, durVal);

                            lookup[code] = new BaseItemProps(null, dur, dur, qty);
                        }
                    }
                }

                // 3. Load misc.txt
                var miscPath = Path.Combine(excelDir, "misc.txt");
                if (File.Exists(miscPath))
                {
                    var lines = File.ReadAllLines(miscPath);
                    if (lines.Length > 1)
                    {
                        var header = lines[0].Split('\t');
                        int codeIdx = Array.IndexOf(header, "code");
                        int stackIdx = Array.IndexOf(header, "stackable");

                        for (int i = 1; i < lines.Length; i++)
                        {
                            var cols = lines[i].Split('\t');
                            if (cols.Length <= codeIdx) continue;
                            var code = cols[codeIdx].Trim();
                            if (code.Length == 0) continue;

                            bool isStack = stackIdx >= 0 && cols.Length > stackIdx && cols[stackIdx].Trim() == "1";
                            lookup[code] = new BaseItemProps(null, null, null, isStack ? (ushort)1 : null);
                        }
                    }
                }

                _cachedBaseProps = lookup;
            }

            if (_cachedBaseProps.TryGetValue(itemCode.Trim(), out var result))
                return result;

            return new BaseItemProps(null, null, null, null);
        }
    }

    public static Dictionary<int, Dictionary<(int StatId, int Layer), (int Min, int Max)>> GetAuthoritativeRanges(string excelDir)
    {
        lock (_rangesLock)
        {
            if (_cachedUniqueRanges != null) return _cachedUniqueRanges;
            var propertyToStats = GameDataTables.BuildPropertyToStatsLookup(excelDir);
            var statNameToId = GameDataTables.BuildStatNameToIdLookup(excelDir);
            var (_, skillNameToId) = GameDataTables.BuildSkillLookups(excelDir, new Dictionary<string, string>());
            var propGroups = GameDataTables.BuildPropertyGroupsLookup(excelDir);
            var catalog = new PropertyRangeCatalog(propertyToStats, statNameToId, skillNameToId, propGroups);
            _cachedUniqueRanges = catalog.BuildUniqueStatRangesLookup(excelDir);
            return _cachedUniqueRanges;
        }
    }

    private static HashSet<int>? _cachedInherentlyEtherealUniques;
    private static readonly object _etherealLock = new();

    public static bool IsUniqueInherentlyEthereal(int uniqueId, string excelDir)
    {
        lock (_etherealLock)
        {
            if (_cachedInherentlyEtherealUniques != null)
                return _cachedInherentlyEtherealUniques.Contains(uniqueId);

            var set = new HashSet<int> { 23, 32, 175, 250, 324, 333, 334, 386, 504 };
            try
            {
                var path = Path.Combine(excelDir, "uniqueitems.txt");
                if (File.Exists(path))
                {
                    var lines = File.ReadAllLines(path);
                    if (lines.Length > 1)
                    {
                        var header = lines[0].Split('\t');
                        int idIdx = Array.IndexOf(header, "*ID");
                        if (idIdx >= 0)
                        {
                            var propIndices = new List<int>();
                            for (int p = 1; p <= 12; p++)
                            {
                                int idx = Array.IndexOf(header, $"prop{p}");
                                if (idx >= 0) propIndices.Add(idx);
                            }

                            set.Clear();
                            for (int i = 1; i < lines.Length; i++)
                            {
                                var line = lines[i];
                                if (string.IsNullOrWhiteSpace(line)) continue;
                                var cols = line.Split('\t');
                                if (cols.Length <= idIdx || !int.TryParse(cols[idIdx].Trim(), out int id))
                                    continue;

                                foreach (var pIdx in propIndices)
                                {
                                    if (cols.Length > pIdx && cols[pIdx].Trim().Equals("ethereal", StringComparison.OrdinalIgnoreCase))
                                    {
                                        set.Add(id);
                                        break;
                                    }
                                }
                            }
                        }
                    }
                }
            }
            catch
            {
                // Fall back to default set
            }

            _cachedInherentlyEtherealUniques = set;
            return _cachedInherentlyEtherealUniques.Contains(uniqueId);
        }
    }

    [System.Runtime.Versioning.UnsupportedOSPlatform("browser")]
    public static int RunCli(string[] args, string excelDir)
    {
        try
        {
            for (var i = 1; i < args.Length - 1; i++)
            {
                if (args[i] == "--excel") excelDir = args[++i];
            }

            var json = Console.In.ReadToEnd();
            var request = JsonSerializer.Deserialize<NetNewItemRequest>(json, new JsonSerializerOptions
            {
                PropertyNameCaseInsensitive = true,
                Converters = { new System.Text.Json.Serialization.JsonStringEnumConverter() }
            }) ?? new();

            string? source = null, target = null;
            for (var i = 1; i < args.Length - 1; i++)
            {
                if (args[i] == "--source") source = args[++i];
                else if (args[i] == "--target") target = args[++i];
            }

            if (string.IsNullOrWhiteSpace(source) || string.IsNullOrWhiteSpace(target))
            {
                Console.WriteLine("{\"success\":false,\"error\":\"--source and --target are required\"}");
                return 2;
            }

            var before = File.ReadAllBytes(source);
            var targetBefore = File.Exists(target) ? File.ReadAllBytes(target) : before;

            bool isStash = target.EndsWith(".d2i", StringComparison.OrdinalIgnoreCase);
            var (bytes, error) = isStash
                ? CreateStashItem(targetBefore, request.TabIndex, request, excelDir)
                : CreateCharacterItem(targetBefore, request, excelDir);

            if (bytes == null)
            {
                Console.WriteLine(JsonSerializer.Serialize(new { success = false, error }));
                return 1;
            }

            var backup = SaveFileTransaction.Commit(new SaveFileTransaction.Update(target, targetBefore, bytes))[0];
            Console.WriteLine(JsonSerializer.Serialize(new { success = true, backup }));
            return 0;
        }
        catch (Exception ex)
        {
            Console.WriteLine(JsonSerializer.Serialize(new { success = false, error = ex.Message }));
            return 1;
        }
    }

    private static (Item? Item, string? Error) BuildItem(NetNewItemRequest request, string excelDir, ContainerGrid2D grid, bool isStash)
    {
        if (string.IsNullOrWhiteSpace(request.ItemCode) || request.ItemCode.Trim().Length != 3)
            return (null, "Item code must be exactly three characters.");

        var statEntries = new List<(StatId Id, int Layer, long Value)>();
        if (request.ItemStats != null && request.ItemStats.Count > 0)
        {
            foreach (var s in request.ItemStats)
                statEntries.Add((s.Id, s.Layer, s.Value));
        }
        else if (request.Stats != null && request.Stats.Count > 0)
        {
            foreach (var (id, val) in request.Stats)
                statEntries.Add((id, 0, val));
        }

        statEntries.RemoveAll(s => (int)s.Id < 0);

        bool isEth = request.IsEthereal || (request.Ethereal == true);
        if (!isEth && request.Quality == ItemQuality.Unique && request.QualityIndex.HasValue)
        {
            isEth = IsUniqueInherentlyEthereal(request.QualityIndex.Value, excelDir);
        }

        if (request.Quality == ItemQuality.Unique)
        {
            if (!request.QualityIndex.HasValue)
                return (null, "Unique items require a valid QualityIndex (unique item ID).");

            var uniqueRanges = GetAuthoritativeRanges(excelDir);
            if (uniqueRanges.TryGetValue(request.QualityIndex.Value, out var expectedRanges))
            {
                if (statEntries.Count == 0 && expectedRanges.Count > 0)
                    return (null, $"Unique item ID {request.QualityIndex.Value} requires stats matching its definition; stats cannot be empty.");

                foreach (var (key, range) in expectedRanges)
                {
                    if (!statEntries.Any(s => (int)s.Id == key.StatId && s.Layer == key.Layer))
                    {
                        return (null, $"Unique item {request.QualityIndex.Value} is missing required stat {(StatId)key.StatId} (layer {key.Layer}).");
                    }
                }

                foreach (var stat in statEntries)
                {
                    if (expectedRanges.TryGetValue(((int)stat.Id, stat.Layer), out var range))
                    {
                        if (stat.Value < range.Min || stat.Value > range.Max)
                            return (null, $"Stat {stat.Id} (layer {stat.Layer}) value {stat.Value} is outside allowed range [{range.Min}-{range.Max}].");
                    }
                    else if (request.AllowedRanges != null && request.AllowedRanges.TryGetValue(stat.Id, out var clientRange))
                    {
                        if (stat.Value < clientRange.Min || stat.Value > clientRange.Max)
                            return (null, $"Stat {stat.Id} value {stat.Value} is outside allowed range [{clientRange.Min}-{clientRange.Max}].");
                    }
                    else
                    {
                        return (null, $"Stat {stat.Id} (layer {stat.Layer}) is not permitted on unique item {request.QualityIndex.Value}.");
                    }
                }
            }
        }
        else
        {
            foreach (var stat in statEntries)
            {
                if (request.AllowedRanges == null || !request.AllowedRanges.TryGetValue(stat.Id, out var range))
                    return (null, $"Stat {stat.Id} is missing an explicit BKDiablo allowed range.");
                if (stat.Value < range.Min || stat.Value > range.Max)
                    return (null, $"Stat {stat.Id} value {stat.Value} is outside the allowed range [{range.Min}-{range.Max}].");
            }
        }

        var itemDims = ItemDimensionsLookup.LoadFromExcel(excelDir);
        var (w, h) = itemDims.GetSize(request.ItemCode);
        int posX = request.X;
        int posY = request.Y;
        if (posX < 0 || posY < 0 || !grid.CanPlace(posX, posY, w, h))
        {
            var freeSlot = grid.FindFirstAvailableSlot(w, h);
            if (!freeSlot.HasValue)
                return (null, isStash ? "No stash space available in this tab for this item." : "No inventory space available for this item.");
            posX = freeSlot.Value.X;
            posY = freeSlot.Value.Y;
        }

        var finalStats = new List<Stat>();
        foreach (var s in statEntries)
        {
            if ((int)s.Id == 194) continue; // Sockets are represented by ItemFlags.Socketed and Sockets list

            long serializedVal = s.Value;
            if (s.Id is StatId.MaxLife or StatId.MaxMana or StatId.MaxStamina or StatId.LifePerLevel or StatId.ManaPerLevel)
            {
                serializedVal <<= 8;
            }
            else if ((s.Id is StatId.ItemChargedSkill || (int)s.Id == 204) && serializedVal <= 255)
            {
                serializedVal = (serializedVal << 8) | serializedVal;
            }
            finalStats.Add(new Stat { Id = s.Id, Layer = s.Layer, Value = serializedVal });
        }

        var baseProps = GetBaseItemProps(request.ItemCode, excelDir);

        var flags = ItemFlags.Identified | (ItemFlags)0x00800000;
        var socketStat = statEntries.FirstOrDefault(s => (int)s.Id == 194);
        var sockets = new List<Item?>();
        if (socketStat != default && socketStat.Value > 0)
        {
            flags |= ItemFlags.Socketed;
            for (int i = 0; i < socketStat.Value; i++)
            {
                sockets.Add(null);
            }
        }

        ushort? defense = baseProps.Defense;
        byte? durability = baseProps.Durability;
        byte? maxDurability = baseProps.MaxDurability;

        if (isEth)
        {
            flags |= ItemFlags.Ethereal;
            if (defense.HasValue)
            {
                defense = (ushort)((defense.Value * 3) / 2);
            }
            if (maxDurability.HasValue && maxDurability.Value > 0)
            {
                byte newDur = (byte)((maxDurability.Value / 2) + 1);
                maxDurability = newDur;
                durability = newDur;
            }
        }

        var item = new Item
        {
            Version = 101,
            ItemCodeString = request.ItemCode.Trim(),
            ItemLevel = request.ItemLevel > 0 ? request.ItemLevel : (byte)99,
            ItemSeed = request.Seed == 0 ? (uint)Random.Shared.NextInt64(1, int.MaxValue) : request.Seed,
            Quality = request.Quality,
            QualityData = request.QualityIndex.HasValue && (request.Quality == ItemQuality.Unique || request.Quality == ItemQuality.Set)
                ? new SetUniqueQualityData { SetUniqueFileIndex = request.QualityIndex.Value }
                : null,
            Flags = flags,
            Defense = defense,
            Durability = durability,
            MaxDurability = maxDurability,
            Quantity = baseProps.Quantity,
            Sockets = sockets,
            Position = new ItemPosition
            {
                Mode = ItemMode.Stored,
                StorePage = isStash ? StorePage.Stash : StorePage.Inventory,
                InvX = (byte)posX,
                InvY = (byte)posY
            },
            Stats = finalStats
        };

        return (item, null);
    }

    public static (byte[]? Bytes, string? Error) CreateCharacterItem(byte[] source, NetNewItemRequest request, string excelDir)
    {
        try
        {
            var external = new TxtFileExternalData(excelDir, version: 105);
            var save = D2Save.Read(source, external);
            var dims = ContainerDimensions.LoadFromExcel(excelDir);
            var itemDims = ItemDimensionsLookup.LoadFromExcel(excelDir);
            var grid = ContainerGrid2D.BuildCharacterGrid(save, StorePage.Inventory, dims, itemDims);
            var (item, error) = BuildItem(request, excelDir, grid, isStash: false);
            if (item == null) return (null, error);
            save.Items.Add(item);
            return (save.ToBytes(external, 105), null);
        }
        catch (Exception ex) { return (null, $"Unable to create item: {ex.Message}"); }
    }

    public static (byte[]? Bytes, string? Error) CreateStashItem(byte[] source, int tabIndex, NetNewItemRequest request, string excelDir)
    {
        try
        {
            var external = new TxtFileExternalData(excelDir, version: 105);
            var stash = D2StashSave.Read(source, external);
            if (tabIndex < 0 || tabIndex >= stash.Count) return (null, "Invalid stash tab.");
            var dims = ContainerDimensions.LoadFromExcel(excelDir);
            var itemDims = ItemDimensionsLookup.LoadFromExcel(excelDir);
            var grid = ContainerGrid2D.BuildSharedStashGrid(stash[tabIndex], dims, itemDims);
            var (item, error) = BuildItem(request, excelDir, grid, isStash: true);
            if (item == null) return (null, error);
            stash[tabIndex].Items.Add(item);
            return (stash.ToBytes(external, 105), null);
        }
        catch (Exception ex) { return (null, $"Unable to create stash item: {ex.Message}"); }
    }
}
