using System;
using System.IO;
using D2SSharp.Data;
using D2SSharp.Enums;
using D2SSharp.Model;

Console.WriteLine("=================================================");
Console.WriteLine("    D2R Save & Stash Regression Test Suite       ");
Console.WriteLine("=================================================");

var projectDir = @"E:\Games\d2sitems";
var excelDir = @"E:\Games\Diablo II Resurrected\Mods\BKDiablo\bkdiablo.mpq\data\global\excel";
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

Console.WriteLine("\n=================================================");
Console.WriteLine($"Results: {passed} passed, {failed} failed.");
Console.WriteLine("=================================================");
return failed == 0 ? 0 : 1;
