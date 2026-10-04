using D2SItems;
using D2SSharp.Data;
using D2SSharp.Model;
using D2SSharp.Enums;

var excel = args[0];
var external = new TxtFileExternalData(excel, 105);
var dims = ContainerDimensions.LoadFromExcel(excel);
var sizes = ItemDimensionsLookup.LoadFromExcel(excel);
if (args.Length == 3 && args[1] == "--recovery-audit")
{
    var root = args[2];
    var backupDir = Path.Combine(root, "backups");
    var stashOriginal = File.ReadAllBytes(Directory.GetFiles(backupDir, "20261003_203409_*_ModernSharedStashHardCoreV2.d2i").Single());
    var expectedStash = D2StashSave.Read(stashOriginal, external);
    foreach (var (name, prefix) in new[] { ("TestBarb", "20261003_203409_"), ("TestAmazon", "20261003_203425_") })
    {
        var original = File.ReadAllBytes(Directory.GetFiles(backupDir, prefix + "*_" + name + ".d2s").Single());
        var before = D2Save.Read(original, external);
        var current = D2Save.Read(File.ReadAllBytes(Path.Combine(root, name + ".d2s")), external);
        var oldSeeds = before.Items.Select(i => i.ItemSeed).ToHashSet();
        var added = current.Items.Where(i => !oldSeeds.Contains(i.ItemSeed)).ToArray();
        foreach (var item in added)
        {
            var matches = expectedStash.SelectMany(t => t.Items.Select(i => (t, i)))
                .Where(x => x.i.ItemSeed == item.ItemSeed && x.i.ItemCodeString == item.ItemCodeString).ToArray();
            if (matches.Length != 1) throw new Exception("Ambiguous recovery item " + item.ItemSeed);
            matches[0].t.Items.Remove(matches[0].i);
            current.Items.Remove(item);
        }
        var restored = current.ToBytes(external, 105);
        var baseline = before.ToBytes(external, 105);
        if (!restored.SequenceEqual(baseline)) throw new Exception(name + " has other changes; cannot restore whole file safely. Lengths " + restored.Length + "/" + baseline.Length + "; differences " + string.Join(",", Enumerable.Range(0, Math.Min(restored.Length, baseline.Length)).Where(i => restored[i] != baseline[i]).Take(30)));
        Console.WriteLine($"{name}: {added.Length} added items match hardcore source; removing them reproduces original bytes.");
    }
    if (!expectedStash.ToBytes(external, 105).SequenceEqual(File.ReadAllBytes(Path.Combine(root, "ModernSharedStashHardCoreV2.d2i"))))
        throw new Exception("Stash has other changes; cannot restore whole file safely.");
    Console.WriteLine("Stash matches original minus the identified transfers byte-for-byte. No files written.");
    return;
}
Console.WriteLine("Stash fields: " + string.Join(", ", typeof(D2StashTab).GetProperties().Select(p => p.Name + ":" + p.PropertyType.Name)));
foreach (var path in args.Skip(1))
{
    var save = D2Save.Read(File.ReadAllBytes(path), external);
    Console.WriteLine($"{Path.GetFileName(path)}: {save.Items.Count} items; flags={save.Character.Flags}");
    foreach (var page in new[] { StorePage.Inventory, StorePage.Cube, StorePage.Stash })
    {
        var (w, h) = page == StorePage.Inventory ? dims.GetInventorySize(save.Character.Class.ToString())
            : page == StorePage.Cube ? dims.CubeSize : dims.StashSize;
        var grid = new ContainerGrid2D(w, h);
        int count = 0, cells = 0, invalid = 0;
        foreach (var item in save.Items.Where(i => i.Position.Mode == ItemMode.Stored && i.Position.StorePage == page))
        {
            var (iw, ih) = sizes.GetSize(item.ItemCodeString);
            count++; cells += iw * ih;
            if (!grid.CanPlace(item.Position.InvX, item.Position.InvY, iw, ih))
            {
                invalid++;
                Console.WriteLine($"INVALID {page} {item.ItemCodeString} seed={item.ItemSeed} at {item.Position.InvX},{item.Position.InvY} size {iw}x{ih}");
            }
            grid.MarkOccupied(item.Position.InvX, item.Position.InvY, iw, ih);
        }
        Console.WriteLine($"  {page}: {count} items, {cells}/{w*h} cells ({w}x{h}), {invalid} invalid placements");
    }
}
