using System;
using System.IO;
using D2SSharp.Data;
using D2SSharp.Enums;
using D2SSharp.Model;

Console.WriteLine("=================================================");
Console.WriteLine("    D2R Save & Stash Regression Test Suite       ");
Console.WriteLine("=================================================");
D2SItems.InspectQuests.Run();

var projectDir = Path.GetFullPath(".");
var excelDir = Path.GetFullPath("mods/BKDiablo/bkdiablo.mpq/data/global/excel");
var baselinesDir = Path.Combine(projectDir, "tests", "fixtures", "baselines");

if (!Directory.Exists(baselinesDir))
{
    Console.WriteLine($"Error: Baselines directory '{baselinesDir}' not found.");
    return 1;
}

var externalData = new TxtFileExternalData(excelDir, version: 105);
int passed = 0;
int failed = 0;

// Test 1: Round-trip test on all 8 golden character baselines
Console.WriteLine("\n[1/4] Testing bit-for-bit round-trip serialization on character baselines...");
var goldenD2S = Directory.GetFiles(baselinesDir, "*_L1.golden.d2s");
foreach (var file in goldenD2S)
{
    var fname = Path.GetFileName(file);
    var rawBytes = File.ReadAllBytes(file);
    try
    {
        var save = D2Save.Read(rawBytes, externalData);
        var outBytes = save.ToBytes(externalData, 105);
        if (rawBytes.Length == outBytes.Length && rawBytes.AsSpan().SequenceEqual(outBytes))
        {
            Console.WriteLine($"  [PASS] {fname} ({rawBytes.Length}b) -> Exact match (0 diffs)");
            passed++;
        }
        else
        {
            Console.WriteLine($"  [FAIL] {fname}: Length or byte mismatch!");
            failed++;
        }
    }
    catch (Exception ex)
    {
        Console.WriteLine($"  [FAIL] {fname}: Exception {ex.Message}");
        failed++;
    }
}

// Test 2: Round-trip test on golden shared stash
Console.WriteLine("\n[2/4] Testing bit-for-bit round-trip serialization on shared stash...");
var goldenStash = Path.Combine(baselinesDir, "ModernSharedStashSoftCoreV2.golden.d2i");
if (File.Exists(goldenStash))
{
    var rawBytes = File.ReadAllBytes(goldenStash);
    try
    {
        var stash = D2StashSave.Read(rawBytes, externalData);
        var outBytes = stash.ToBytes(externalData, 105);
        if (rawBytes.Length == outBytes.Length && rawBytes.AsSpan().SequenceEqual(outBytes))
        {
            Console.WriteLine($"  [PASS] ModernSharedStashSoftCoreV2.golden.d2i ({rawBytes.Length}b) -> Exact match (0 diffs)");
            passed++;
        }
        else
        {
            Console.WriteLine($"  [FAIL] Shared stash: Length or byte mismatch!");
            failed++;
        }
    }
    catch (Exception ex)
    {
        Console.WriteLine($"  [FAIL] Shared stash: Exception {ex.Message}");
        failed++;
    }
}

// Test 3: Generate a character for each of the 8 classes and verify reloadability
Console.WriteLine("\n[3/4] Testing character generation across all 8 classes...");
var classes = new[] { "Amazon", "Assassin", "Barbarian", "Druid", "Necromancer", "Paladin", "Sorceress", "Warlock" };
var tempDir = Path.Combine(Path.GetTempPath(), "d2sitems_test_" + Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(tempDir);

try
{
    foreach (var cls in classes)
    {
        string name = $"Gen{cls}";
        int res = D2SItems.MuleGenerator.Run(
            new[] { "create-mule", "--name", name, "--class", cls, "--save-dir", tempDir },
            tempDir,
            excelDir
        );

        if (res != 0)
        {
            Console.WriteLine($"  [FAIL] Generator failed for class {cls}");
            failed++;
            continue;
        }

        var genFile = Path.Combine(tempDir, $"{name}.d2s");
        var genBytes = File.ReadAllBytes(genFile);
        var loaded = D2Save.Read(genBytes, externalData);

        if (loaded.Character.Preview.Name == name && loaded.Character.Class.ToString().Equals(cls, StringComparison.OrdinalIgnoreCase))
        {
            Console.WriteLine($"  [PASS] Generated {cls} '{name}' ({genBytes.Length}b, Items: {loaded.Items.Count})");
            passed++;
        }
        else
        {
            Console.WriteLine($"  [FAIL] Verification failed for {cls}: Name='{loaded.Character.Preview.Name}' Class={loaded.Character.Class}");
            failed++;
        }
    }
}
finally
{
    if (Directory.Exists(tempDir))
        Directory.Delete(tempDir, true);
}

// Test 4: Quest & Waypoint completion tests
Console.WriteLine("\n[4/4] Testing Quest & Waypoint completion engine...");
var questTestDir = Path.Combine(Path.GetTempPath(), "d2sitems_quest_test_" + Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(questTestDir);

try
{
    // Generate a test Paladin
    string qChar = "TestQHero";
    int mRes = D2SItems.MuleGenerator.Run(
        new[] { "create-mule", "--name", qChar, "--class", "Paladin", "--save-dir", questTestDir },
        questTestDir,
        excelDir
    );
    if (mRes != 0)
    {
        Console.WriteLine("  [FAIL] Failed to generate test character for quest suite");
        failed++;
    }
    else
    {
        var charFile = Path.Combine(questTestDir, $"{qChar}.d2s");

        // Subtest 4a: Complete Normal difficulty only
        int cliRes = D2SItems.QuestManager.RunCli(
            new[] { "complete-quests", "--char", qChar, "--diff", "normal", "--save-dir", questTestDir, "--excel", excelDir },
            questTestDir,
            excelDir
        );

        if (cliRes != 0)
        {
            Console.WriteLine("  [FAIL] QuestManager CLI returned non-zero for Normal completion");
            failed++;
        }
        else
        {
            var bytes1 = File.ReadAllBytes(charFile);
            var save1 = D2Save.Read(bytes1, externalData);

            bool normalOk =
                save1.Quests.Normal.ActI.DenOfEvil != 0 &&
                save1.Quests.Normal.ActI.Completion != 0 &&
                save1.Quests.Normal.ActV.EveOfDestruction != 0 &&
                save1.Quests.Normal.ActV.Completion == (QuestFlags)0x8002 &&
                save1.Waypoints.Normal.ActI == ActIWaypoints.All &&
                save1.Waypoints.Normal.ActIV == ActIVWaypoints.All &&
                save1.Quests.Nightmare.ActI.DenOfEvil == 0; // NM remains untouched

            if (normalOk)
            {
                Console.WriteLine("  [PASS] Normal quests & waypoints completed; NM untouched");
                passed++;
            }
            else
            {
                Console.WriteLine("  [FAIL] Normal quests or waypoints verification failed");
                failed++;
            }
        }

        // Subtest 4b: Complete All difficulties with rewards
        int cliResAll = D2SItems.QuestManager.RunCli(
            new[] { "complete-quests", "--char", qChar, "--diff", "all", "--rewards", "--save-dir", questTestDir, "--excel", excelDir },
            questTestDir,
            excelDir
        );

        if (cliResAll != 0)
        {
            Console.WriteLine("  [FAIL] QuestManager CLI returned non-zero for All completion");
            failed++;
        }
        else
        {
            var bytes2 = File.ReadAllBytes(charFile);
            var save2 = D2Save.Read(bytes2, externalData);

            bool allOk =
                save2.Quests.Normal.ActV.Completion == (QuestFlags)0x8002 &&
                save2.Quests.Nightmare.ActV.Completion == (QuestFlags)0x8002 &&
                save2.Quests.Hell.ActV.Completion == (QuestFlags)0x8002 &&
                save2.Waypoints.Normal.ActI == ActIWaypoints.All &&
                save2.Waypoints.Nightmare.ActI == ActIWaypoints.All &&
                save2.Waypoints.Hell.ActI == ActIWaypoints.All &&
                save2.Stats.GetStat(StatId.SkillPoints) >= 12; // 4 skill points * 3 diffs

            if (allOk)
            {
                Console.WriteLine($"  [PASS] All difficulties completed, waypoints unlocked, rewards granted (SkillPoints={save2.Stats.GetStat(StatId.SkillPoints)})");
                passed++;
            }
            else
            {
                Console.WriteLine("  [FAIL] All difficulties verification failed");
                failed++;
            }
        }

        // Subtest 4c: Verify safety guard blocks live main character without --force-live
        int guardRes = D2SItems.QuestManager.RunCli(
            new[] { "complete-quests", "--char", "Sorceress", "--save-dir", questTestDir, "--excel", excelDir },
            questTestDir,
            excelDir
        );

        // Expect return code 2 (Safety Guard)
        if (guardRes == 2)
        {
            Console.WriteLine("  [PASS] Safety guard successfully blocked live character modification");
            passed++;
        }
        else
        {
            Console.WriteLine($"  [FAIL] Safety guard failed to block live character (code={guardRes})");
            failed++;
        }
    }
}
finally
{
    if (Directory.Exists(questTestDir))
        Directory.Delete(questTestDir, true);
}

// Test 5: Item Transfer Engine & 2D Collision Verification (Phase 3)
Console.WriteLine("\n[5/5] Testing Item Transfer Engine & 2D Collision Model...");
var transferTestDir = Path.Combine(Path.GetTempPath(), "d2sitems_transfer_test_" + Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(transferTestDir);

try
{
    // 5.1 Verify Container Dimensions and Item Footprints loaded from mod files
    var dims = D2SItems.ContainerDimensions.LoadFromExcel(excelDir);
    var itemDims = D2SItems.ItemDimensionsLookup.LoadFromExcel(excelDir);

    var invAmazon = dims.GetInventorySize("Amazon");
    var invWarlock = dims.GetInventorySize("Warlock");
    var stashSize = dims.StashSize;
    var cubeSize = dims.CubeSize;

    bool dimsOk = invAmazon == (11, 8) && invWarlock == (11, 8) && stashSize == (16, 13) && cubeSize == (6, 6);
    var cm1Size = itemDims.GetSize("cm1");
    var cm2Size = itemDims.GetSize("cm2");
    var cm3Size = itemDims.GetSize("cm3");
    var boxSize = itemDims.GetSize("box");
    var rinSize = itemDims.GetSize("rin");
    bool footOk = cm1Size == (1, 1) && cm2Size == (1, 2) && cm3Size == (1, 3) && boxSize == (2, 2) && rinSize == (1, 1);

    if (dimsOk && footOk)
    {
        Console.WriteLine($"  [PASS] Mod dimensions verified: Inv={invAmazon.Width}x{invAmazon.Height}, Stash={stashSize.Width}x{stashSize.Height}, Cube={cubeSize.Width}x{cubeSize.Height}; cm3={cm3Size.Width}x{cm3Size.Height}");
        passed++;
    }
    else
    {
        Console.WriteLine($"  [FAIL] Dimension verification failed: Inv={invAmazon}, Stash={stashSize}, Cube={cubeSize}, cm3={cm3Size}");
        failed++;
    }

    // 5.2 2D Grid Collision Detection & Placement search
    var testGrid = new D2SItems.ContainerGrid2D(11, 8);
    testGrid.MarkOccupied(0, 0, 2, 2); // Place 2x2 at (0, 0)
    bool c1 = !testGrid.CanPlace(0, 0, 1, 1); // overlap -> false
    bool c2 = !testGrid.CanPlace(1, 1, 1, 1); // overlap -> false
    bool c3 = testGrid.CanPlace(2, 0, 1, 1);  // adjacent free -> true
    bool c4 = !testGrid.CanPlace(10, 7, 2, 2); // out of bounds -> false
    var slot = testGrid.FindFirstAvailableSlot(2, 2);
    bool c5 = slot.HasValue && slot.Value == (2, 0);

    if (c1 && c2 && c3 && c4 && c5)
    {
        Console.WriteLine("  [PASS] 2D collision detection and placement math verified");
        passed++;
    }
    else
    {
        Console.WriteLine($"  [FAIL] 2D collision math failed: c1={c1}, c2={c2}, c3={c3}, c4={c4}, slot={slot}");
        failed++;
    }

    // Prepare fixture copies in temp test dir
    var testStashFile = Path.Combine(transferTestDir, "ModernSharedStashSoftCoreV2.d2i");
    File.Copy(Path.Combine(baselinesDir, "ModernSharedStashSoftCoreV2.golden.d2i"), testStashFile);

    string tHero = "TestTransfer";
    D2SItems.MuleGenerator.Run(
        new[] { "create-mule", "--name", tHero, "--class", "Barbarian", "--save-dir", transferTestDir },
        transferTestDir,
        excelDir
    );
    var testCharFile = Path.Combine(transferTestDir, $"{tHero}.d2s");

    // 5.3 Transfer item from Shared Stash Tab 0 -> Character Inventory
    var stashBefore = D2StashSave.Read(File.ReadAllBytes(testStashFile), externalData);
    var charBefore = D2Save.Read(File.ReadAllBytes(testCharFile), externalData);
    int stashCount0 = stashBefore[0].Items.Count;
    int charInvCount0 = charBefore.Items.Count(i => i.Position.Mode == ItemMode.Stored && i.Position.StorePage == StorePage.Inventory);

    var sampleItem = stashBefore[0].Items[0];
    var sampleSeed = sampleItem.ItemSeed;
    var sampleCode = sampleItem.ItemCodeString.Trim();

    var transferRes = D2SItems.ItemTransferManager.TransferItem(new D2SItems.ItemTransferRequest
    {
        SourceFile = testStashFile,
        SourceContainer = D2SItems.ContainerType.SharedStash,
        SourceTab = 0,
        ItemSeed = sampleSeed,
        TargetFile = testCharFile,
        TargetContainer = D2SItems.ContainerType.Inventory,
        ExcelDir = excelDir
    });

    if (!transferRes.Success)
    {
        Console.WriteLine($"  [FAIL] Single item transfer failed: {transferRes.Message}");
        failed++;
    }
    else
    {
        // Reload files from disk and verify
        var stashAfter = D2StashSave.Read(File.ReadAllBytes(testStashFile), externalData);
        var charAfter = D2Save.Read(File.ReadAllBytes(testCharFile), externalData);

        int stashCount1 = stashAfter[0].Items.Count;
        int charInvCount1 = charAfter.Items.Count(i => i.Position.Mode == ItemMode.Stored && i.Position.StorePage == StorePage.Inventory);

        var transferredItem = charAfter.Items.FirstOrDefault(i => i.ItemSeed == sampleSeed);
        bool itemInChar = transferredItem != null &&
                          transferredItem.Position.InvX == transferRes.PlacedX &&
                          transferredItem.Position.InvY == transferRes.PlacedY &&
                          transferredItem.Position.StorePage == StorePage.Inventory;

        bool itemRemovedFromStash = stashAfter[0].Items.All(i => i.ItemSeed != sampleSeed);

        if (stashCount1 == stashCount0 - 1 && charInvCount1 == charInvCount0 + 1 && itemInChar && itemRemovedFromStash)
        {
            Console.WriteLine($"  [PASS] Stash -> Inv transfer verified ({sampleCode} placed at {transferRes.PlacedX},{transferRes.PlacedY})");
            passed++;
        }
        else
        {
            Console.WriteLine($"  [FAIL] Transfer verification failed: stashCount={stashCount1} (was {stashCount0}), invCount={charInvCount1} (was {charInvCount0})");
            failed++;
        }
    }

    // 5.4 Transfer item back from Character Inventory -> Shared Stash Tab 0
    var returnRes = D2SItems.ItemTransferManager.TransferItem(new D2SItems.ItemTransferRequest
    {
        SourceFile = testCharFile,
        SourceContainer = D2SItems.ContainerType.Inventory,
        ItemSeed = sampleSeed,
        TargetFile = testStashFile,
        TargetContainer = D2SItems.ContainerType.SharedStash,
        TargetTab = 0,
        ExcelDir = excelDir
    });

    if (returnRes.Success)
    {
        var stashReloaded = D2StashSave.Read(File.ReadAllBytes(testStashFile), externalData);
        var charReloaded = D2Save.Read(File.ReadAllBytes(testCharFile), externalData);
        int stashFinal = stashReloaded[0].Items.Count;
        int charFinal = charReloaded.Items.Count(i => i.Position.Mode == ItemMode.Stored && i.Position.StorePage == StorePage.Inventory);

        if (stashFinal == stashCount0 && charFinal == charInvCount0)
        {
            Console.WriteLine("  [PASS] Round-trip transfer (Inv -> Stash) restored exact original item counts");
            passed++;
        }
        else
        {
            Console.WriteLine($"  [FAIL] Round-trip count mismatch: stashFinal={stashFinal}, charFinal={charFinal}");
            failed++;
        }
    }
    else
    {
        Console.WriteLine($"  [FAIL] Return transfer failed: {returnRes.Message}");
        failed++;
    }

    // 5.5 Out-of-bounds / occupied collision rejection
    var badTransferRes = D2SItems.ItemTransferManager.TransferItem(new D2SItems.ItemTransferRequest
    {
        SourceFile = testStashFile,
        SourceContainer = D2SItems.ContainerType.SharedStash,
        SourceTab = 0,
        ItemSeed = sampleSeed,
        TargetFile = testCharFile,
        TargetContainer = D2SItems.ContainerType.Inventory,
        TargetX = 100, // Invalid coordinate
        TargetY = 100,
        ExcelDir = excelDir
    });

    if (!badTransferRes.Success)
    {
        Console.WriteLine("  [PASS] Invalid / colliding coordinate transfer successfully rejected");
        passed++;
    }
    else
    {
        Console.WriteLine("  [FAIL] Out of bounds transfer was unexpectedly accepted!");
        failed++;
    }

    // 5.6 Live Main Character Safety Guard rejection
    var liveGuardRes = D2SItems.ItemTransferManager.TransferItem(new D2SItems.ItemTransferRequest
    {
        SourceFile = testStashFile,
        SourceContainer = D2SItems.ContainerType.SharedStash,
        SourceTab = 0,
        ItemSeed = sampleSeed,
        TargetFile = Path.Combine(transferTestDir, "Sorceress.d2s"),
        TargetContainer = D2SItems.ContainerType.Inventory,
        ExcelDir = excelDir
    });

    if (!liveGuardRes.Success && liveGuardRes.IsProtected)
    {
        Console.WriteLine("  [PASS] Live character safety guard blocked transfer without --force-live");
        passed++;
    }
    else
    {
        Console.WriteLine("  [FAIL] Live character safety guard failed to block transfer!");
        failed++;
    }

    // 5.7 Bulk Mule Packing test
    var bulkRes = D2SItems.ItemTransferManager.FillCharacterFromStash(new D2SItems.BulkTransferRequest
    {
        SourceStashFile = testStashFile,
        SourceTab = 0,
        TargetCharFile = testCharFile,
        ItemFilter = "all",
        MaxItems = 15,
        ExcelDir = excelDir
    });

    if (bulkRes.Success && bulkRes.ItemsMoved > 0)
    {
        var finalChar = D2Save.Read(File.ReadAllBytes(testCharFile), externalData);
        Console.WriteLine($"  [PASS] Bulk mule filling packed {bulkRes.ItemsMoved} items into character (Total items: {finalChar.Items.Count})");
        passed++;
    }
    else
    {
        Console.WriteLine($"  [FAIL] Bulk mule packing failed: {bulkRes.Message}");
        failed++;
    }
}
finally
{
    if (Directory.Exists(transferTestDir))
        Directory.Delete(transferTestDir, true);
}

// [6/6] Testing StackEditorManager (Edit & Add Stackable Items)
Console.WriteLine("\n[6/6] Testing StackEditorManager (Edit & Add Stackable Items)...");
var stackTestDir = Path.Combine(Path.GetTempPath(), $"d2sitems_stack_test_{Guid.NewGuid():N}");
Directory.CreateDirectory(stackTestDir);
try
{
    var testStashFile = Path.Combine(stackTestDir, "ModernSharedStashSoftCoreV2.d2i");
    File.Copy(goldenStash, testStashFile);

    // 6.1 Edit existing advanced stash stack item to quantity 5
    var initialStash = D2StashSave.Read(File.ReadAllBytes(testStashFile), externalData);
    var stack = initialStash.SelectMany((tab, index) => tab.Items.Select(item => (item, index)))
        .First(x => initialStash[x.index].TabType == StashTabType.AdvancedStash && x.item.AdvancedStashStackSize.HasValue && initialStash[x.index].Items.Count(i => i.ItemSeed == x.item.ItemSeed && i.ItemCodeString == x.item.ItemCodeString) == 1);

    var editRes = D2SItems.StackEditorManager.EditStack(new D2SItems.EditStackRequest
    {
        StashFile = testStashFile,
        TabIndex = stack.index,
        ItemCode = stack.item.ItemCodeString.Trim(),
        ItemSeed = stack.item.ItemSeed,
        Quantity = 5,
        ExcelDir = excelDir
    });

    if (editRes.Success && editRes.NewQuantity == 5)
    {
        var verifyStash = D2StashSave.Read(File.ReadAllBytes(testStashFile), externalData);
        var editedItem = verifyStash[stack.index].Items.FirstOrDefault(i => i.ItemSeed == stack.item.ItemSeed);
        if (editedItem != null && editedItem.AdvancedStashStackSize == 5)
        {
            Console.WriteLine($"  [PASS] Successfully updated '{stack.item.ItemCodeString.Trim()}' stack size to 5");
            passed++;
        }
        else
        {
            Console.WriteLine($"  [FAIL] '{stack.item.ItemCodeString.Trim()}' stack size readback mismatch: expected 5, got {editedItem?.AdvancedStashStackSize}");
            failed++;
        }
    }
    else
    {
        Console.WriteLine($"  [FAIL] EditStack failed: {editRes.Message}");
        failed++;
    }

    // 6.2 Zero quantity is safely rejected (deletion is separate)
    var zeroRes = D2SItems.StackEditorManager.EditStack(new D2SItems.EditStackRequest
    {
        StashFile = testStashFile,
        TabIndex = stack.index,
        ItemCode = stack.item.ItemCodeString.Trim(),
        ItemSeed = stack.item.ItemSeed,
        Quantity = 0,
        ExcelDir = excelDir
    });

    if (!zeroRes.Success)
    {
        Console.WriteLine("  [PASS] EditStack correctly rejected zero quantity");
        passed++;
    }
    else
    {
        Console.WriteLine("  [FAIL] EditStack unexpectedly allowed zero quantity!");
        failed++;
    }

    // 6.3 Missing or invalid item seed is safely rejected
    var badSeedRes = D2SItems.StackEditorManager.EditStack(new D2SItems.EditStackRequest
    {
        StashFile = testStashFile,
        TabIndex = stack.index,
        ItemCode = stack.item.ItemCodeString.Trim(),
        ItemSeed = uint.MaxValue,
        Quantity = 10,
        ExcelDir = excelDir
    });

    if (!badSeedRes.Success)
    {
        Console.WriteLine("  [PASS] EditStack correctly rejected invalid item seed");
        passed++;
    }
    else
    {
        Console.WriteLine("  [FAIL] EditStack unexpectedly succeeded with invalid seed!");
        failed++;
    }
}
finally
{
    if (Directory.Exists(stackTestDir))
        Directory.Delete(stackTestDir, true);
}

// Test 7: Corpse gear recognition and Mercenary isolation
Console.WriteLine("\n[7/7] Testing Corpse gear recognition and Mercenary isolation...");
var sorcSaveFile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Saved Games", "Diablo II Resurrected", "Mods", "BKDiablo", "Sorceress.d2s");
if (File.Exists(sorcSaveFile))
{
    var sorcBytes = File.ReadAllBytes(sorcSaveFile);
    var engine = new D2SItems.SaveInspectorEngine(excelDir, Path.Combine(projectDir, "web", "assets"));
    var result = engine.ProcessCharacterSaveData("Sorceress.d2s", sorcBytes);

    var charInfo = (Dictionary<string, object>)result["character"];
    var hasCorpse = (bool)charInfo["hasCorpse"];
    var allItems = (List<Dictionary<string, object?>>)result["items"];
    var mercItems = (List<Dictionary<string, object?>>)result["mercenary"];

    // 1. Verify corpse detection
    if (hasCorpse)
    {
        Console.WriteLine("  [PASS] hasCorpse flag correctly identified on dead character");
        passed++;
    }
    else
    {
        Console.WriteLine("  [FAIL] hasCorpse flag was not set!");
        failed++;
    }

    // 2. Verify all 12 equipped corpse items are present with normalized slot names
    var equippedSlots = new HashSet<string>();
    foreach (var it in allItems)
    {
        if (it.TryGetValue("isCorpse", out var isC) && isC is true)
        {
            var loc = it["location"]?.ToString();
            if (loc != null) equippedSlots.Add(loc);
        }
    }

    var expectedSlots = new[] { "Head", "Neck", "Torso", "RightHand", "LeftHand", "Gloves", "Belt", "Boots", "RightRing", "LeftRing", "AlternateRightHand", "AlternateLeftHand" };
    int matchedSlots = expectedSlots.Count(s => equippedSlots.Contains(s));
    if (matchedSlots == 12)
    {
        Console.WriteLine($"  [PASS] All 12/12 equipped slots recovered from corpse with normalized slot names");
        passed++;
    }
    else
    {
        Console.WriteLine($"  [FAIL] Only {matchedSlots}/12 corpse slots recovered! Missing: {string.Join(", ", expectedSlots.Where(s => !equippedSlots.Contains(s)))}");
        failed++;
    }

    // 3. Verify mercenary items are isolated and not polluting character equipped gear
    bool mercIsolated = mercItems.Count == 7 && mercItems.All(m => m.ContainsKey("isMercenary") && (bool)m["isMercenary"]!);
    bool noMercInEquipped = !allItems.Any(i => i.ContainsKey("isMercenary") && (bool)i["isMercenary"]! && !i["location"]!.ToString()!.StartsWith("Mercenary"));
    if (mercIsolated && noMercInEquipped)
    {
        Console.WriteLine($"  [PASS] Mercenary items ({mercItems.Count}) isolated with 'Mercenary' location prefix");
        passed++;
    }
    else
    {
        Console.WriteLine("  [FAIL] Mercenary items leaked into character equipped items!");
        failed++;
    }
}

Console.WriteLine("\n=================================================");
Console.WriteLine($"Results: {passed} passed, {failed} failed.");
Console.WriteLine("=================================================");
return failed == 0 ? 0 : 1;
