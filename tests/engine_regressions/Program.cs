using D2SItems;
using D2SSharp.Data;
using D2SSharp.Model;
using D2SSharp.Enums;
using System.Reflection;

var excel = args.Length > 0 ? args[0] : @"E:\Games\Diablo II Resurrected\Mods\BKDiablo\bkdiablo.mpq\data\global\excel";
var fixtures = Path.GetFullPath("tests/fixtures/baselines");
var external = new TxtFileExternalData(excel, version: 105);
void Check(bool value, string message) { if (!value) throw new Exception(message); Console.WriteLine("PASS " + message); }
var bytes = File.ReadAllBytes(Path.Combine(fixtures, "Amazon_L1.golden.d2s"));
var createRequest = new NetNewItemRequest { ItemCode = "r01", ItemLevel = 1, X = 9, Y = 9 };
var createdItem = NetNewItemManager.CreateCharacterItem(bytes, createRequest, excel);
Check(createdItem.Bytes != null, createdItem.Error ?? "net-new item creation failed");
var createdSave = D2Save.Read(createdItem.Bytes!, external);
Check(createdSave.Items.Count == D2Save.Read(bytes, external).Items.Count + 1, "net-new item is serialized into character save");
createRequest.Stats[StatId.Strength] = 999;
Check(NetNewItemManager.CreateCharacterItem(bytes, createRequest, excel).Bytes == null, "net-new item rejects stats without explicit ranges");
var emptyUniqueReq = new NetNewItemRequest { ItemCode = "uap", Quality = ItemQuality.Unique, QualityIndex = 248, X = 0, Y = 0 };
Check(NetNewItemManager.CreateCharacterItem(bytes, emptyUniqueReq, excel).Bytes == null, "net-new unique item rejects empty stats");
var badUniqueReq = new NetNewItemRequest
{
    ItemCode = "uap", Quality = ItemQuality.Unique, QualityIndex = 248, X = 0, Y = 0,
    ItemStats = new List<NetNewItemStat>
    {
        new() { Id = StatId.AllSkills, Layer = 0, Value = 2 },
        new() { Id = StatId.MagicFind, Layer = 0, Value = 30 },
        new() { Id = StatId.DamageReduced, Layer = 0, Value = 10 },
        new() { Id = StatId.Strength, Layer = 0, Value = 2 },
        new() { Id = StatId.Dexterity, Layer = 0, Value = 2 },
        new() { Id = StatId.Vitality, Layer = 0, Value = 2 },
        new() { Id = StatId.Energy, Layer = 0, Value = 2 }
    }
};
Check(NetNewItemManager.CreateCharacterItem(bytes, badUniqueReq, excel).Bytes == null, "net-new unique item rejects out-of-range stats");
var missingStatReq = new NetNewItemRequest
{
    ItemCode = "uap", Quality = ItemQuality.Unique, QualityIndex = 248, X = 0, Y = 0,
    ItemStats = new List<NetNewItemStat> { new() { Id = StatId.AllSkills, Layer = 0, Value = 2 } }
};
Check(NetNewItemManager.CreateCharacterItem(bytes, missingStatReq, excel).Bytes == null, "net-new unique item rejects missing required stats");
var validUniqueReq = new NetNewItemRequest
{
    ItemCode = "uap", Quality = ItemQuality.Unique, QualityIndex = 248, X = -1, Y = -1,
    ItemStats = new List<NetNewItemStat>
    {
        new() { Id = StatId.AllSkills, Layer = 0, Value = 2 },
        new() { Id = StatId.LifePerLevel, Layer = 0, Value = 12 },
        new() { Id = StatId.ManaPerLevel, Layer = 0, Value = 12 },
        new() { Id = StatId.MagicFind, Layer = 0, Value = 50 },
        new() { Id = StatId.DamageReduced, Layer = 0, Value = 10 },
        new() { Id = StatId.Strength, Layer = 0, Value = 2 },
        new() { Id = StatId.Dexterity, Layer = 0, Value = 2 },
        new() { Id = StatId.Vitality, Layer = 0, Value = 2 },
        new() { Id = StatId.Energy, Layer = 0, Value = 2 }
    }
};
var validRes = NetNewItemManager.CreateCharacterItem(bytes, validUniqueReq, excel);
Check(validRes.Bytes != null, validRes.Error ?? "valid unique item creation failed");
var validSave = D2Save.Read(validRes.Bytes!, external);
var shako = validSave.Items.Last();
Check(shako.Quality == ItemQuality.Unique && ((SetUniqueQualityData)shako.QualityData!).SetUniqueFileIndex == 248, "valid unique item serialized with correct unique ID");
var first = QuestManager.CompleteQuestsBytes(bytes, "all", null, true, true, excel);
Check(first.Success, first.Message);
var second = QuestManager.CompleteQuestsBytes(first.OutBytes!, "all", null, true, true, excel);
Check(second.Success && first.OutBytes!.SequenceEqual(second.OutBytes!), "repeated quest completion is byte-identical");
var stashBytes = File.ReadAllBytes(Path.Combine(fixtures, "ModernSharedStashSoftCoreV2.golden.d2i"));
var stash = D2StashSave.Read(stashBytes, external);
var stack = stash.SelectMany((tab, index) => tab.Items.Select(item => (item, index)))
    .First(x => stash[x.index].TabType == StashTabType.AdvancedStash && x.item.AdvancedStashStackSize.HasValue && stash[x.index].Items.Count(i => i.ItemSeed == x.item.ItemSeed && i.ItemCodeString == x.item.ItemCodeString) == 1);
var request = new EditStackRequest { TabIndex = stack.index, ItemCode = stack.item.ItemCodeString.Trim(), ItemSeed = stack.item.ItemSeed, Quantity = 37 };
var edited = StackEditorManager.EditStackBytes(stashBytes, request, excel);
Check(edited.result.Success, edited.result.Message);
var read = D2StashSave.Read(edited.newStashBytes!, external);
Check(read[stack.index].Items.Single(i => i.ItemSeed == stack.item.ItemSeed && i.ItemCodeString == stack.item.ItemCodeString).AdvancedStashStackSize == 37, "exact stack edited");
request.ItemSeed = uint.MaxValue;
Check(!StackEditorManager.EditStackBytes(stashBytes, request, excel).result.Success, "wrong stack seed cannot fall back to code");
request.ItemSeed = stack.item.ItemSeed;
request.Quantity = 256;
Check(!StackEditorManager.EditStackBytes(stashBytes, request, excel).result.Success, "invalid quantity rejected without clamping");
request.TabIndex = -1;
Check(!StackEditorManager.EditStackBytes(stashBytes, request, excel).result.Success, "missing tab rejected");
var engine = new SaveInspectorEngine(excel);
foreach (var field in new[] { "_uniqueStatRanges", "_setStatRanges", "_runewordStatRanges" })
{
    var ranges = (System.Collections.IDictionary)typeof(SaveInspectorEngine).GetField(field, BindingFlags.NonPublic | BindingFlags.Instance)!.GetValue(engine)!;
    Check(ranges.Count > 20, field + " populated: " + ranges.Count);
}
var properties = new Dictionary<string, List<PropertyEntry>> { ["test-class"] = [new(21, "classskill", "6")], ["test-tab"] = [new(10, "skilltab", "4")] };
var catalog = new PropertyRangeCatalog(properties, new() { ["classskill"] = 83, ["skilltab"] = 188 }, new());
var testDir = Path.Combine(Path.GetTempPath(), "bk-catalog-" + Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(testDir);
File.WriteAllText(Path.Combine(testDir, "uniqueitems.txt"), "index\t*ID\tprop1\tpar1\tmin1\tmax1\tprop2\tpar2\tmin2\tmax2\nTest\t901\ttest-class\t\t1\t3\ttest-tab\t\t2\t4\n");
var synthetic = catalog.BuildUniqueStatRangesLookup(testDir);
Check(synthetic[901][(83, 6)] == (1, 3) && synthetic[901][(188, 9)] == (2, 4), "header-based IDs and class/skill-tab layers respected");
Console.WriteLine("All engine regression checks passed; golden fixtures were read only.");

foreach (var charClass in new[] { "Amazon", "Assassin", "Barbarian", "Druid", "Necromancer", "Paladin", "Sorceress", "Warlock" })
{
    var created = MuleGenerator.CreateMuleBytes("TestMule", charClass, false, excel, fixtures);
    Check(created.error == null, "create " + charClass + ": " + created.error);
    var generated = D2Save.Read(created.d2sBytes!, external);
    Check(generated.Character.Preview.Name == "TestMule" && generated.Stats.GetStat(StatId.MaxStamina) == 115 * 256,
        charClass + " uses mod starting stamina");
}
var excelCopy = Path.Combine(testDir, "excel");
Directory.CreateDirectory(excelCopy);
foreach (var file in Directory.EnumerateFiles(excel)) File.Copy(file, Path.Combine(excelCopy, Path.GetFileName(file)));
var statPath = Path.Combine(excelCopy, "charstats.txt");
var lines = File.ReadAllLines(statPath);
var columns = lines[0].Split('\t');
for (int i = 1; i < lines.Length; i++)
{
    var row = lines[i].Split('\t');
    if (row[0] != "Amazon") continue;
    row[Array.IndexOf(columns, "str")] = "99";
    lines[i] = string.Join('\t', row);
}
File.WriteAllLines(statPath, lines);
var modified = MuleGenerator.CreateMuleBytes("ChangedMod", "Amazon", false, excelCopy, fixtures);
Check(modified.error == null && D2Save.Read(modified.d2sBytes!, external).Stats.GetStat(StatId.Strength) == 99,
    "changed mod starting strength changes generated character");

var rune = stash[5].Items.First(i => i.ItemCodeString.Trim() == "r08");
var withdraw = ItemTransferManager.TransferItemBytes(stashBytes, bytes, new ItemTransferRequest { SourceFile = "ModernSharedStashSoftCoreV2.d2i", TargetFile = "ModernSharedStashSoftCoreV2.d2i",
    SourceContainer = ContainerType.SharedStash, SourceTab = 5, ItemSeed = rune.ItemSeed,
    ItemCode = "r08", TargetContainer = ContainerType.Inventory }, excel);
Check(withdraw.result.Success, "advanced withdrawal: " + withdraw.result.Message);
var afterBank = D2StashSave.Read(withdraw.newSourceBytes!, external);
var afterCharacter = D2Save.Read(withdraw.newTargetBytes!, external);
Check(afterBank[5].Items.Single(i => i.ItemCodeString.Trim() == "r08").AdvancedStashStackSize == rune.AdvancedStashStackSize - 1,
    "withdrawal decrements bank by exactly one");
var withdrawn = afterCharacter.Items.Single(i => i.ItemCodeString.Trim() == "r08");
var deposit = ItemTransferManager.TransferItemBytes(withdraw.newTargetBytes!, withdraw.newSourceBytes!, new ItemTransferRequest { SourceFile = "ModernSharedStashSoftCoreV2.d2i", TargetFile = "ModernSharedStashSoftCoreV2.d2i",
    SourceContainer = ContainerType.Inventory, ItemSeed = withdrawn.ItemSeed, ItemCode = "r08",
    TargetContainer = ContainerType.SharedStash, TargetTab = 5 }, excel);
Check(deposit.result.Success, "advanced deposit: " + deposit.result.Message);
Check(D2StashSave.Read(deposit.newTargetBytes!, external)[5].Items.Single(i => i.ItemCodeString.Trim() == "r08").AdvancedStashStackSize == rune.AdvancedStashStackSize,
    "withdrawal/deposit round trip conserves bank quantity");
Check(D2Save.Read(deposit.newSourceBytes!, external).Items.Count == D2Save.Read(bytes, external).Items.Count,
    "withdrawal/deposit round trip conserves character item count");
var fullBank = D2StashSave.Read(stashBytes, external);
fullBank[5].Items.Single(i => i.ItemCodeString.Trim() == "r08").AdvancedStashStackSize = 255;
var overflow = ItemTransferManager.TransferItemBytes(withdraw.newTargetBytes!, fullBank.ToBytes(external, 105), new ItemTransferRequest { SourceFile = "ModernSharedStashSoftCoreV2.d2i", TargetFile = "ModernSharedStashSoftCoreV2.d2i",
    SourceContainer = ContainerType.Inventory, ItemSeed = withdrawn.ItemSeed, ItemCode = "r08",
    TargetContainer = ContainerType.SharedStash, TargetTab = 5 }, excel);
Check(!overflow.result.Success && overflow.newSourceBytes == null && overflow.newTargetBytes == null,
    "overflow rejects both replacements without losing source rune");
var charm = stash[0].Items.First(i => i.ItemCodeString.Trim() == "cm1");
var invalidBank = ItemTransferManager.TransferItemBytes(stashBytes, null, new ItemTransferRequest { SourceFile = "ModernSharedStashSoftCoreV2.d2i", TargetFile = "ModernSharedStashSoftCoreV2.d2i",
    SourceContainer = ContainerType.SharedStash, SourceTab = 0, ItemSeed = charm.ItemSeed, ItemCode = "cm1",
    TargetContainer = ContainerType.SharedStash, TargetTab = 5 }, excel);
Check(!invalidBank.result.Success && invalidBank.newSourceBytes == null, "mod bank rejects non-stackable charm");
var stale = ItemTransferManager.TransferItemBytes(stashBytes, bytes, new ItemTransferRequest { SourceFile = "ModernSharedStashSoftCoreV2.d2i", TargetFile = "ModernSharedStashSoftCoreV2.d2i",
    SourceRevision = "stale", SourceContainer = ContainerType.SharedStash, SourceTab = 0,
    ItemSeed = charm.ItemSeed, ItemCode = "cm1", TargetContainer = ContainerType.Inventory }, excel);
Check(!stale.result.Success && stale.newSourceBytes == null, "stale transfer revision rejected");
request.TabIndex = 0; request.Quantity = 2; request.ItemCode = "cm1"; request.ItemSeed = charm.ItemSeed;
Check(!StackEditorManager.EditStackBytes(stashBytes, request, excel).result.Success, "tab zero is preserved and rejects normal-grid quantity editing");
request.TabIndex = stack.index; request.ItemCode = stack.item.ItemCodeString.Trim(); request.ItemSeed = stack.item.ItemSeed;
request.Revision = "stale";
Check(!StackEditorManager.EditStackBytes(stashBytes, request, excel).result.Success, "stale stack revision rejected");
request.Revision = null;
Check(!StackEditorManager.EditStackBytes(bytes, request, excel).result.Success, "character bytes cannot be edited as a stash stack");
var parityDir = Path.Combine(testDir, "parity");
var bulkRequest = new BulkTransferRequest { SourceStashFile = "ModernSharedStashSoftCoreV2.d2i",
    SourceRevision = "stale", TargetRevision = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(bytes)),
    SourceTab = 0, MaxItems = 1, ExcelDir = excel
};
var bulkStale = ItemTransferManager.BulkTransferBytes(stashBytes, bytes, bulkRequest, excel);
Check(!bulkStale.result.Success && bulkStale.newStashBytes == null && bulkStale.newCharBytes == null
    && bulkStale.result.Message.Contains("source shared stash"), "bulk stale source rejects without output bytes");
bulkRequest.SourceRevision = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(stashBytes));
bulkRequest.TargetRevision = "stale";
var bulkTargetStale = ItemTransferManager.BulkTransferBytes(stashBytes, bytes, bulkRequest, excel);
Check(!bulkTargetStale.result.Success && bulkTargetStale.newStashBytes == null && bulkTargetStale.newCharBytes == null
    && bulkTargetStale.result.Message.Contains("destination character"), "bulk stale destination rejects without output bytes");
bulkRequest.TargetRevision = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(bytes));
var bulkFresh = ItemTransferManager.BulkTransferBytes(stashBytes, bytes, bulkRequest, excel);
bulkRequest.SourceStashFile = "ModernSharedStashHardCoreV2.d2i";
var crossCore = ItemTransferManager.BulkTransferBytes(stashBytes, bytes, bulkRequest, excel);
Check(!crossCore.result.Success && crossCore.newCharBytes == null && crossCore.newStashBytes == null
    && crossCore.result.Message.Contains("Hardcore and softcore"), "cross-core bulk transfer rejected without replacements");
var crossSingle = ItemTransferManager.TransferItemBytes(stashBytes, bytes, new ItemTransferRequest {
    SourceFile = "ModernSharedStashHardCoreV2.d2i", SourceContainer = ContainerType.SharedStash,
    TargetFile = "Hero.d2s", TargetContainer = ContainerType.Inventory, SourceTab = 0,
    ItemSeed = charm.ItemSeed, ItemCode = "cm1" }, excel);
Check(!crossSingle.result.Success && crossSingle.newSourceBytes == null && crossSingle.newTargetBytes == null
    && crossSingle.result.Message.Contains("Hardcore and softcore"), "cross-core single transfer rejected without replacements");
Check(bulkFresh.result.Success && bulkFresh.result.ItemsMoved == 1, "bulk transfer succeeds with refreshed revisions");
Check(D2StashSave.Read(bulkFresh.newStashBytes!, external).Sum(t => t.Items.Count)
    + D2Save.Read(bulkFresh.newCharBytes!, external).Items.Count
    == D2StashSave.Read(stashBytes, external).Sum(t => t.Items.Count) + D2Save.Read(bytes, external).Items.Count,
    "bulk transfer conserves item count");
Directory.CreateDirectory(parityDir);
var comparisonFiles = Directory.EnumerateFiles(fixtures).Where(path => path.EndsWith(".d2s") || path.EndsWith(".d2i")).ToArray();
foreach (var fixturePath in comparisonFiles) File.Copy(fixturePath, Path.Combine(parityDir, Path.GetFileName(fixturePath)));
var cli = new System.Diagnostics.ProcessStartInfo("dotnet") { UseShellExecute = false, RedirectStandardOutput = true, RedirectStandardError = true };
cli.ArgumentList.Add(typeof(SaveInspectorEngine).Assembly.Location);
cli.ArgumentList.Add("--excel"); cli.ArgumentList.Add(excel); cli.ArgumentList.Add(parityDir);
using (var process = System.Diagnostics.Process.Start(cli)!)
{
    var stdout = process.StandardOutput.ReadToEndAsync();
    var stderr = process.StandardError.ReadToEndAsync();
    process.WaitForExit();
    Check(process.ExitCode == 0, "CLI fixture scan: " + stderr.Result);
}
var parityEngine = new SaveInspectorEngine(excel, excludedItems: new[] { "Level 90 Reward", "Game Modifiers", "Blank Charm" });
foreach (var fixturePath in comparisonFiles)
{
    var name = Path.GetFileName(fixturePath);
    var raw = File.ReadAllBytes(fixturePath);
    var shared = name.EndsWith(".d2i") ? parityEngine.ProcessSharedStashToJson(name, raw) : parityEngine.ProcessCharacterSaveToJson(name, raw);
    var cliJson = System.Text.Json.Nodes.JsonNode.Parse(File.ReadAllText(Path.ChangeExtension(Path.Combine(parityDir, name), ".json")))!;
    var engineJson = System.Text.Json.Nodes.JsonNode.Parse(shared)!;
    Check(System.Text.Json.Nodes.JsonNode.DeepEquals(cliJson, engineJson), "CLI/shared engine parity: " + name);
    if (!System.Text.Json.Nodes.JsonNode.DeepEquals(cliJson, engineJson))
    {
        File.WriteAllText(Path.Combine(parityDir, name + ".engine.json"), shared);
        Console.WriteLine("PARITY DIFFERENCES " + name + ": " + string.Join(", ", cliJson.AsObject().Where(pair => !System.Text.Json.Nodes.JsonNode.DeepEquals(pair.Value, engineJson[pair.Key])).Select(pair => pair.Key)));
    }
}
Console.WriteLine("Parity artifacts: " + parityDir);

var packedInput = new Dictionary<string, byte[]> {
    ["ModernSharedStashSoftCoreV2.d2i"] = stashBytes, ["Mule.d2s"] = bytes
};
var packing = new MulePackingPlan { Source = "ModernSharedStashSoftCoreV2.d2i", AutoCreate = true };
var packed = MulePackingPlanner.Plan(packedInput, packing, excel, fixtures);
Check(packed.Moved > 0 && packed.Created.Count > 0 && packed.Remaining == 0, "auto packing creates categorized mules and fills normal tabs");
Check(packedInput[packing.Source].SequenceEqual(stashBytes), "packing does not mutate input snapshots");
var packedStash = D2StashSave.Read(packed.Files[packing.Source], external);
Check(packedStash[5].Items.Count == stash[5].Items.Count, "auto packing leaves advanced bank alone");
var packedItemCount = packed.Files.Where(p => p.Key.EndsWith(".d2s") && p.Key != "Mule.d2s")
    .Sum(p => D2Save.Read(p.Value, external).Items.Count);
var generatedBaseCount = packed.Created.Sum(file => D2Save.Read(MuleGenerator.CreateMuleBytes(
    Path.GetFileNameWithoutExtension(file), "Amazon", false, excel, fixtures).d2sBytes!, external).Items.Count);
Check(packedItemCount - generatedBaseCount == packed.Moved, "new mule item gains exactly match removed stash items");
foreach (var file in packed.Created)
{
    var character = D2Save.Read(packed.Files[file], external);
    foreach (var page in new[] { StorePage.Inventory, StorePage.Stash, StorePage.Cube })
    {
        var dimensions = ContainerDimensions.LoadFromExcel(excel);
        var size = page == StorePage.Inventory ? dimensions.GetInventorySize("Amazon") : page == StorePage.Stash ? dimensions.StashSize : dimensions.CubeSize;
        var grid = new ContainerGrid2D(size.Width, size.Height);
        foreach (var item in character.Items.Where(i => i.Position.Mode == ItemMode.Stored && i.Position.StorePage == page))
        {
            var footprint = ItemDimensionsLookup.LoadFromExcel(excel).GetSize(item.ItemCodeString);
            if (!grid.CanPlace(item.Position.InvX, item.Position.InvY, footprint.Width, footprint.Height)) throw new Exception("Packed mule overlap: " + file);
            grid.MarkOccupied(item.Position.InvX, item.Position.InvY, footprint.Width, footprint.Height);
        }
    }
}
Check(true, "all generated mule placements fit without overlap");

