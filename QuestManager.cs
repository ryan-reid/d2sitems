using System;
using System.IO;
using D2SSharp.Data;
using D2SSharp.Enums;
using D2SSharp.Model;

namespace D2SItems;

public static class QuestManager
{
    public static int RunCli(string[] args, string defaultSaveDir, string defaultExcelDir)
    {
        string? charName = null;
        string difficulty = "all";
        int? actNum = null;
        bool unlockWaypoints = true;
        bool grantRewards = true;
        bool forceLive = false;
        bool jsonOutput = false;
        string? revision = null;
        string saveDir = defaultSaveDir;
        string excelDir = defaultExcelDir;

        for (int i = 1; i < args.Length; i++)
        {
            var arg = args[i];
            if ((arg == "--char" || arg == "-c") && i + 1 < args.Length)
                charName = args[++i];
            else if ((arg == "--diff" || arg == "--difficulty" || arg == "-d") && i + 1 < args.Length)
                difficulty = args[++i].ToLowerInvariant();
            else if ((arg == "--act" || arg == "-a") && i + 1 < args.Length)
            {
                if (int.TryParse(args[++i], out var a) && a >= 1 && a <= 5)
                    actNum = a;
                else
                {
                    Console.Error.WriteLine("Act must be an integer from 1 to 5.");
                    return 1;
                }
            }
            else if (arg == "--no-waypoints")
                unlockWaypoints = false;
            else if (arg == "--waypoints" || arg == "--unlock-waypoints")
                unlockWaypoints = true;
            else if (arg == "--no-rewards")
                grantRewards = false;
            else if (arg == "--rewards")
                grantRewards = true;
            else if (arg == "--force-live")
                forceLive = true;
            else if (arg == "--revision" && i + 1 < args.Length)
                revision = args[++i];
            else if (arg == "--json")
                jsonOutput = true;
            else if (arg == "--save-dir" && i + 1 < args.Length)
                saveDir = args[++i];
            else if (arg == "--excel" && i + 1 < args.Length)
                excelDir = args[++i];
        }

        if (string.IsNullOrWhiteSpace(charName))
        {
            Console.WriteLine("Error: Character name (--char <Name>) is required.");
            Console.WriteLine("Usage: d2sitems.exe complete-quests --char <Name> [--diff normal|nightmare|hell|all] [--act 1-5] [--unlock-waypoints] [--rewards] [--force-live]");
            return 1;
        }

        if (difficulty is not ("normal" or "nightmare" or "nm" or "hell" or "all"))
        {
            Console.Error.WriteLine("Unknown difficulty; use normal, nightmare, hell, or all.");
            return 1;
        }

        // Resolve character file path
        string charPath = charName;
        if (!File.Exists(charPath))
        {
            charPath = Path.Combine(saveDir, charName.EndsWith(".d2s", StringComparison.OrdinalIgnoreCase) ? charName : $"{charName}.d2s");
        }

        // Safety check for live main characters
        if ((SaveBackup.IsProtectedLiveCharacter(charName) || SaveBackup.IsProtectedLiveCharacter(charPath)) && !forceLive)
        {
            Console.WriteLine($"[SAFETY GUARD] '{charName}' is a protected live character.");
            Console.WriteLine("To modify live main characters, you must explicitly pass --force-live.");
            return 2;
        }

        if (!File.Exists(charPath))
        {
            Console.WriteLine($"Error: Character save file not found at: {charPath}");
            return 1;
        }

        var result = ModifyCharacter(charPath, excelDir, save =>
        {
            switch (difficulty)
            {
                case "normal":
                    if (actNum.HasValue)
                        CompleteAct(save.Quests.Normal, save.Waypoints.Normal, actNum.Value, unlockWaypoints, grantRewards, save);
                    else
                        CompleteDifficulty(save.Quests.Normal, save.Waypoints.Normal, unlockWaypoints, grantRewards, save, isNormal: true);
                    break;

                case "nightmare":
                case "nm":
                    if (actNum.HasValue)
                        CompleteAct(save.Quests.Nightmare, save.Waypoints.Nightmare, actNum.Value, unlockWaypoints, grantRewards, save);
                    else
                        CompleteDifficulty(save.Quests.Nightmare, save.Waypoints.Nightmare, unlockWaypoints, grantRewards, save, isNightmare: true);
                    break;

                case "hell":
                    if (actNum.HasValue)
                        CompleteAct(save.Quests.Hell, save.Waypoints.Hell, actNum.Value, unlockWaypoints, grantRewards, save);
                    else
                        CompleteDifficulty(save.Quests.Hell, save.Waypoints.Hell, unlockWaypoints, grantRewards, save, isHell: true);
                    break;

                case "all":
                default:
                    CompleteDifficulty(save.Quests.Normal, save.Waypoints.Normal, unlockWaypoints, grantRewards, save, isNormal: true);
                    CompleteDifficulty(save.Quests.Nightmare, save.Waypoints.Nightmare, unlockWaypoints, grantRewards, save, isNightmare: true);
                    CompleteDifficulty(save.Quests.Hell, save.Waypoints.Hell, unlockWaypoints, grantRewards, save, isHell: true);
                    save.Character.TownDifficulty = new byte[] { 0x00, 0x00, 0x80 };
                    break;
            }
        }, revision);

        if (result.Success)
        {
            if (jsonOutput)
            {
                Console.WriteLine($"{{\"success\": true, \"backup\": \"{result.BackupPath?.Replace("\\", "\\\\")}\", \"message\": \"{result.Message}\"}}");
            }
            else
            {
                Console.WriteLine($"[SUCCESS] {result.Message}");
                if (result.BackupPath != null)
                    Console.WriteLine($"[BACKUP] Safety copy saved to: {result.BackupPath}");
            }
            return 0;
        }
        else
        {
            if (jsonOutput)
                Console.WriteLine($"{{\"success\": false, \"error\": \"{result.Message}\"}}");
            else
                Console.WriteLine($"[FAIL] {result.Message}");
            return 1;
        }
    }

    public static (bool Success, string? BackupPath, string Message) ModifyCharacter(
        string filePath,
        string excelDir,
        Action<D2Save> editAction, string? revision = null)
    {
        try
        {
            if (!File.Exists(filePath))
                return (false, null, $"File '{filePath}' does not exist.");

            var rawBytes = File.ReadAllBytes(filePath);
            SaveFileTransaction.VerifyRevision(rawBytes, revision);
            var (success, newBytes, message) = ModifyCharacterBytes(rawBytes, excelDir, editAction);
            if (!success || newBytes == null)
                return (false, null, message);

            var backupPath = SaveFileTransaction.Commit(new SaveFileTransaction.Update(filePath, rawBytes, newBytes))[0];
            return (true, backupPath, $"Successfully updated quests and waypoints for {Path.GetFileName(filePath)} ({newBytes.Length} bytes).");
        }
        catch (Exception ex)
        {
            return (false, null, $"Error modifying character: {ex.Message}");
        }
    }

    public static (bool Success, byte[]? OutBytes, string Message) ModifyCharacterBytes(
        byte[] inputBytes,
        string excelDir,
        Action<D2Save> editAction)
    {
        try
        {
            var externalData = new TxtFileExternalData(excelDir, version: 105);
            var save = D2Save.Read(inputBytes, externalData);

            editAction(save);

            var newBytes = save.ToBytes(externalData, 105);
            return (true, newBytes, "Successfully updated character in memory.");
        }
        catch (Exception ex)
        {
            return (false, null, $"Error modifying character: {ex.Message}");
        }
    }

    public static (bool Success, byte[]? OutBytes, string Message) CompleteQuestsBytes(
        byte[] inputBytes,
        string difficulty,
        int? actNum,
        bool unlockWaypoints,
        bool grantRewards,
        string excelDir)
    {
        if (difficulty.ToLowerInvariant() is not ("normal" or "nightmare" or "nm" or "hell" or "all") || actNum is < 1 or > 5)
            return (false, null, "Invalid difficulty or act; no character changes made.");
        return ModifyCharacterBytes(inputBytes, excelDir, save =>
        {
            switch (difficulty.ToLowerInvariant())
            {
                case "normal":
                    if (actNum.HasValue)
                        CompleteAct(save.Quests.Normal, save.Waypoints.Normal, actNum.Value, unlockWaypoints, grantRewards, save);
                    else
                        CompleteDifficulty(save.Quests.Normal, save.Waypoints.Normal, unlockWaypoints, grantRewards, save, isNormal: true);
                    break;
                case "nightmare":
                case "nm":
                    if (actNum.HasValue)
                        CompleteAct(save.Quests.Nightmare, save.Waypoints.Nightmare, actNum.Value, unlockWaypoints, grantRewards, save);
                    else
                        CompleteDifficulty(save.Quests.Nightmare, save.Waypoints.Nightmare, unlockWaypoints, grantRewards, save, isNightmare: true);
                    break;
                case "hell":
                    if (actNum.HasValue)
                        CompleteAct(save.Quests.Hell, save.Waypoints.Hell, actNum.Value, unlockWaypoints, grantRewards, save);
                    else
                        CompleteDifficulty(save.Quests.Hell, save.Waypoints.Hell, unlockWaypoints, grantRewards, save, isHell: true);
                    break;
                case "all":
                default:
                    CompleteDifficulty(save.Quests.Normal, save.Waypoints.Normal, unlockWaypoints, grantRewards, save, isNormal: true);
                    CompleteDifficulty(save.Quests.Nightmare, save.Waypoints.Nightmare, unlockWaypoints, grantRewards, save, isNightmare: true);
                    CompleteDifficulty(save.Quests.Hell, save.Waypoints.Hell, unlockWaypoints, grantRewards, save, isHell: true);
                    save.Character.TownDifficulty = new byte[] { 0x00, 0x00, 0x80 };
                    break;
            }
        });
    }

    public static void CompleteDifficulty(
        QuestsDifficulty quests,
        WaypointDifficultyData waypoints,
        bool unlockWaypoints,
        bool grantRewards,
        D2Save save,
        bool isNormal = false,
        bool isNightmare = false,
        bool isHell = false)
    {
        for (int act = 1; act <= 5; act++)
        {
            CompleteAct(quests, waypoints, act, unlockWaypoints, grantRewards, save);
        }

        if (isNormal)
        {
            // Switch active town difficulty to Nightmare if currently Normal
            if (save.Character.TownDifficulty.Length >= 3 && save.Character.TownDifficulty[0] != 0)
            {
                save.Character.TownDifficulty = new byte[] { 0x00, 0x80, 0x00 };
            }
        }
        else if (isNightmare || isHell)
        {
            // Switch active town difficulty to Hell
            save.Character.TownDifficulty = new byte[] { 0x00, 0x00, 0x80 };
        }
    }

    public static void CompleteAct(
        QuestsDifficulty quests,
        WaypointDifficultyData waypoints,
        int actNum,
        bool unlockWaypoints,
        bool grantRewards,
        D2Save save)
    {
        bool denRewarded = ((int)quests.ActI.DenOfEvil & 1) != 0;
        bool radamentRewarded = ((int)quests.ActII.RadamentsLair & 1) != 0;
        bool tomeRewarded = ((int)quests.ActIII.LamEsensTome & 1) != 0;
        bool birdRewarded = ((int)quests.ActIII.TheGoldenBird & 1) != 0;
        bool izualRewarded = ((int)quests.ActIV.TheFallenAngel & 1) != 0;
        switch (actNum)
        {
            case 1:
                quests.ActI.Introduction = (QuestFlags)0x0001;
                quests.ActI.DenOfEvil = (QuestFlags)0x1001;
                quests.ActI.SistersBurialGrounds = (QuestFlags)0x1001;
                quests.ActI.ToolsOfTheTrade = (QuestFlags)0x1001;
                quests.ActI.TheSearchForCain = (QuestFlags)0x1019;
                quests.ActI.TheForgottenTower = (QuestFlags)0x1001;
                quests.ActI.SistersToTheSlaughter = (QuestFlags)0x1019;
                quests.ActI.Completion = (QuestFlags)0x0001;
                if (unlockWaypoints)
                    waypoints.ActI = ActIWaypoints.All;
                if (grantRewards && !denRewarded)
                    GrantStat(save, StatId.SkillPoints, 1);
                break;

            case 2:
                quests.ActII.Introduction = (QuestFlags)0x0001;
                quests.ActII.RadamentsLair = (QuestFlags)0x1001;
                quests.ActII.TheHoradricStaff = (QuestFlags)0x1801;
                quests.ActII.TaintedSun = (QuestFlags)0x1005;
                quests.ActII.ArcaneSanctuary = (QuestFlags)0x1181;
                quests.ActII.TheSummoner = (QuestFlags)0x1005;
                quests.ActII.TheSevenTombs = (QuestFlags)0x1025;
                quests.ActII.Completion = (QuestFlags)0x0001;
                if (unlockWaypoints)
                    waypoints.ActII = ActIIWaypoints.All;
                if (grantRewards && !radamentRewarded)
                    GrantStat(save, StatId.SkillPoints, 1);
                break;

            case 3:
                quests.ActIII.Introduction = (QuestFlags)0x0001;
                quests.ActIII.TheGoldenBird = (QuestFlags)0x1001;
                quests.ActIII.BladeOfTheOldReligion = (QuestFlags)0x1001;
                quests.ActIII.KhalimsWill = (QuestFlags)0x1001;
                quests.ActIII.LamEsensTome = (QuestFlags)0x1001;
                quests.ActIII.TheBlackenedTemple = (QuestFlags)0x1009;
                quests.ActIII.TheGuardian = (QuestFlags)0x1841;
                quests.ActIII.Completion = (QuestFlags)0x0001;
                if (unlockWaypoints)
                    waypoints.ActIII = ActIIIWaypoints.All;
                if (grantRewards)
                {
                    if (!tomeRewarded) GrantStat(save, StatId.StatPoints, 5);
                    // Potion of Life (+20 max life stored with 8 fractional bits = 20 * 256)
                    if (!birdRewarded) GrantStat(save, StatId.Life, 20 << 8);
                    if (!birdRewarded) GrantStat(save, StatId.MaxLife, 20 << 8);
                }
                break;

            case 4:
                quests.ActIV.Introduction = (QuestFlags)0x0001;
                quests.ActIV.TheFallenAngel = (QuestFlags)0x1001;
                quests.ActIV.Hellforge = (QuestFlags)0x1001;
                quests.ActIV.TerrorsEnd = (QuestFlags)0x1301;
                quests.ActIV.Completion = (QuestFlags)0x0001;
                if (unlockWaypoints)
                    waypoints.ActIV = ActIVWaypoints.All;
                if (grantRewards && !izualRewarded)
                    GrantStat(save, StatId.SkillPoints, 2);
                break;

            case 5:
                quests.ActV.Introduction = (QuestFlags)0x0001;
                quests.ActV.SiegeOnHarrogath = (QuestFlags)0x1021;
                quests.ActV.RescueOnMountArreat = (QuestFlags)0x1001;
                quests.ActV.PrisonOfIce = (QuestFlags)0x1789; // Scroll consumed + completed
                quests.ActV.BetrayalOfHarrogath = (QuestFlags)0x1001;
                quests.ActV.RiteOfPassage = (QuestFlags)0x1119;
                quests.ActV.EveOfDestruction = (QuestFlags)0x141D;
                quests.ActV.Completion = (QuestFlags)0x8002;
                if (unlockWaypoints)
                    waypoints.ActV = ActVWaypoints.All;
                break;
        }
    }

    private static void GrantStat(D2Save save, StatId statId, long amount)
    {
        try
        {
            var cur = save.Stats.GetStat(statId);
            save.Stats.SetStat(statId, cur + amount, 0);
        }
        catch
        {
            // Stat might not exist yet; attempt direct set
            save.Stats.SetStat(statId, amount, 0);
        }
    }
}
