using System;
using System.IO;
using D2SSharp.Data;
using D2SSharp.Enums;
using D2SSharp.Model;

namespace D2SItems;

public static class InspectQuests
{
    public static void Run()
    {
        var excelDir = @"E:\Games\Diablo II Resurrected\Mods\BKDiablo\bkdiablo.mpq\data\global\excel";
        var saveDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Saved Games", "Diablo II Resurrected", "Mods", "BKDiablo");
        var externalData = new TxtFileExternalData(excelDir, version: 105);
        var testAzFile = Path.Combine(saveDir, "TestAmazon.d2s");
        var testAzBytes = File.ReadAllBytes(testAzFile);
        var saveDir2 = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Saved Games", "Diablo II Resurrected", "Mods", "BKDiablo");
        foreach (var hero in new[] { "Sorceress.d2s", "Assassin.d2s" }) {
            var f = Path.Combine(saveDir2, hero);
            if (File.Exists(f)) {
                var s = D2Save.Read(File.ReadAllBytes(f), externalData);
                var md = s.Character.MercData;
                Console.WriteLine($"\n--- {hero} MercData: HasMerc={md.HasMerc}, Dead={md.IsDead}, HirelingId={md.HirelingId}, NameIndex={md.NameIndex}, Exp={md.Experience}, Items={s.MercItems?.Items.Count} ---");
            }
        }
        var testAzSave = D2Save.Read(testAzBytes, externalData);
        Console.WriteLine($"Normal Act V Compl: 0x{(ushort)testAzSave.Quests.Normal.ActV.Completion:X4}");
        Console.WriteLine($"Normal Act I WP:  0x{(ushort)testAzSave.Waypoints.Normal.ActI:X4}");
        Console.WriteLine($"Normal Act V WP:  0x{(ushort)testAzSave.Waypoints.Normal.ActV:X4}");
        Console.WriteLine($"SkillPoints stat: {testAzSave.Stats.GetStat(D2SSharp.Enums.StatId.SkillPoints)}");
        Console.WriteLine($"StatPoints stat:  {testAzSave.Stats.GetStat(D2SSharp.Enums.StatId.StatPoints)}");
        Console.WriteLine($"Nightmare DenOfEvil: 0x{(ushort)testAzSave.Quests.Nightmare.ActI.DenOfEvil:X4}");
    }

    private static string GetRoman(int i) => i switch { 1 => "I", 2 => "II", 3 => "III", 4 => "IV", 5 => "V", _ => "" };

    private static void DumpDifficulty(string diffName, QuestsDifficulty diff)
    {
        Console.WriteLine($"\n=== {diffName} Quests ===");
        DumpAct("Act I", diff.ActI);
        DumpAct("Act II", diff.ActII);
        DumpAct("Act III", diff.ActIII);
        DumpAct("Act IV", diff.ActIV);
        DumpAct("Act V", diff.ActV);
    }

    private static void DumpAct(string actName, object act)
    {
        Console.WriteLine($"  [{actName}]");
        foreach (var prop in act.GetType().GetProperties())
        {
            var val = prop.GetValue(act);
            if (val != null)
            {
                var num = Convert.ToUInt64(val);
                if (num != 0)
                    Console.WriteLine($"    {prop.Name}: 0x{num:X4} ({val})");
            }
        }
    }
}

