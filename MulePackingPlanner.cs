using D2SSharp.Data;
using D2SSharp.Enums;
using D2SSharp.Model;

namespace D2SItems;

public sealed class MulePackingPlan
{
    public string Source { get; set; } = "";
    public Dictionary<string, string> Assignments { get; set; } = new();
    public bool AutoCreate { get; set; }
    public string Category { get; set; } = "all";
}

/// <summary>Plans on copies only. Callers commit the returned files as one edit session.</summary>
public static class MulePackingPlanner
{
    public static readonly string[] Categories = { "jewelry", "sets", "uniques", "runewords", "crafted", "bases", "charms", "other" };
    public static string Category(Item item, Dictionary<string, string>? types = null)
    {
        var code = item.ItemCodeString.Trim();
        var type = types?.GetValueOrDefault(code, "").ToLowerInvariant() ?? "";
        if (code is "rin" or "amu" or "jew" or "cjw" || type.Contains("jewel") || type is "ring" or "amulet") return "jewelry";
        if (item.Quality == ItemQuality.Set) return "sets";
        if (item.Quality == ItemQuality.Unique) return "uniques";
        if (item.Quality == ItemQuality.Craft) return "crafted";
        if (type.Contains("runeword")) return "runewords";
        if (type.Contains("gem") || type.Contains("skull") || type.Contains("rune") || type.Contains("craft")) return "stacked";
        if (type.Contains("charm")) return "charms";
        if (type.Contains("armor") || type.Contains("weapon")) return "bases";
        return "other";
    }

    public static (Dictionary<string, byte[]> Files, int Moved, int Remaining, List<string> Created) Plan(
        Dictionary<string, byte[]> input, MulePackingPlan plan, string excel, string? baselines = null)
    {
        if (!input.ContainsKey(plan.Source)) throw new ArgumentException("Select a loaded shared stash.");
        if (plan.Category != "all" && !Categories.Contains(plan.Category)) throw new ArgumentException("Unknown mule category.");
        var hardcore = plan.Source.Contains("SharedStashHardCore", StringComparison.OrdinalIgnoreCase);
        if (!hardcore && !plan.Source.Contains("SharedStashSoftCore", StringComparison.OrdinalIgnoreCase))
            throw new ArgumentException("Cannot determine stash mode.");
        var external = new TxtFileExternalData(excel, 105);
        var types = GameDataTables.BuildItemTypeLookup(excel);
        var files = new Dictionary<string, byte[]>(input, StringComparer.OrdinalIgnoreCase);
        var assignments = new Dictionary<string, string>(plan.Assignments, StringComparer.OrdinalIgnoreCase);
        foreach (var (name, category) in assignments)
        {
            if (!Categories.Contains(category) || !files.ContainsKey(name) || !name.EndsWith(".d2s", StringComparison.OrdinalIgnoreCase))
                throw new ArgumentException("Invalid mule assignment: " + name);
            var character = D2Save.Read(files[name], external);
            if (character.Character.Flags.HasFlag(CharacterFlags.Hardcore) != hardcore)
                throw new ArgumentException("Mules must match the shared stash hardcore/softcore mode.");
        }
        var stash = D2StashSave.Read(files[plan.Source], external);
        var candidates = stash.SelectMany((tab, index) => tab.TabType == StashTabType.Normal
            ? tab.Items.Select(item => (Item: item, Tab: index)) : Enumerable.Empty<(Item Item, int Tab)>()).ToArray();
        int moved = 0, remaining = 0;
        var created = new List<string>();
        foreach (var (item, tab) in candidates)
        {
            var category = Category(item, types);
            if (category == "stacked") continue;
            if (plan.Category != "all" && plan.Category != category) continue;
            bool TryMove(string target)
            {
                var request = new ItemTransferRequest {
                    SourceFile = plan.Source, SourceContainer = ContainerType.SharedStash, SourceTab = tab,
                    SourceX = item.Position.InvX, SourceY = item.Position.InvY, ItemSeed = item.ItemSeed, ItemCode = item.ItemCodeString.Trim(),
                    TargetFile = target
                };
                var hasCube = D2Save.Read(files[target], external).Items.Any(i => i.ItemCodeString.Trim() == "box");
                foreach (var container in new[] { ContainerType.Inventory, ContainerType.Cube, ContainerType.Stash })
                {
                    if (container == ContainerType.Cube && !hasCube) continue;
                    request.TargetContainer = container;
                    var result = ItemTransferManager.TransferItemBytes(files[plan.Source], files[target], request, excel);
                    if (!result.result.Success) continue;
                    files[plan.Source] = result.newSourceBytes!;
                    files[target] = result.newTargetBytes!;
                    return true;
                }
                return false;
            }
            if (assignments.Where(x => x.Value == category).Select(x => x.Key).Any(TryMove)) { moved++; continue; }
            if (!plan.AutoCreate || created.Count >= 30) { remaining++; continue; }
            string? newName = null;
            for (int n = 0; n < 676; n++)
            {
                var name = $"{(hardcore ? "HC" : "SC")}{category}{(char)('A' + n / 26)}{(char)('A' + n % 26)}";
                if (!files.ContainsKey(name + ".d2s")) { newName = name; break; }
            }
            if (newName == null) throw new IOException("No available mule name.");
            var generated = MuleGenerator.CreateMuleBytes(newName, "Amazon", hardcore, excel, baselines);
            if (generated.error != null || generated.d2sBytes == null) throw new IOException(generated.error ?? "Mule generation failed.");
            var file = newName + ".d2s";
            files[file] = generated.d2sBytes;
            if (!TryMove(file)) { files.Remove(file); remaining++; continue; }
            if (generated.ctlBytes != null) files[newName + ".ctl"] = generated.ctlBytes;
            assignments[file] = category;
            created.Add(file); moved++;
        }
        return (files, moved, remaining, created);
    }
}
