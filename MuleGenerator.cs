using System;
using System.IO;
using D2SSharp.Data;
using D2SSharp.Enums;
using D2SSharp.Model;

namespace D2SItems;

public static class MuleGenerator
{
    private static readonly string[] ValidClasses = new[]
    {
        "Amazon", "Assassin", "Barbarian", "Druid", "Necromancer", "Paladin", "Sorceress", "Warlock"
    };

    public static int Run(string[] args, string defaultSaveDir, string excelDir)
    {
        string? name = null;
        string? charClass = null;
        bool hardcore = false;
        string saveDir = defaultSaveDir;

        for (int i = 0; i < args.Length; i++)
        {
            if (args[i] == "--name" && i + 1 < args.Length)
                name = args[++i];
            else if (args[i] == "--class" && i + 1 < args.Length)
                charClass = args[++i];
            else if (args[i] == "--hardcore")
                hardcore = true;
            else if (args[i] == "--save-dir" && i + 1 < args.Length)
                saveDir = args[++i];
        }

        if (string.IsNullOrWhiteSpace(name))
        {
            Console.WriteLine("Error: --name <CharacterName> is required.");
            return 1;
        }

        if (string.IsNullOrWhiteSpace(charClass))
        {
            Console.WriteLine($"Error: --class <ClassName> is required. Options: {string.Join(", ", ValidClasses)}");
            return 1;
        }

        // Normalize class name
        var matchedClass = ValidClasses.FirstOrDefault(c => c.Equals(charClass, StringComparison.OrdinalIgnoreCase));
        if (matchedClass == null)
        {
            Console.WriteLine($"Error: Invalid class '{charClass}'. Valid options: {string.Join(", ", ValidClasses)}");
            return 1;
        }

        // Validate destination
        var targetD2S = Path.Combine(saveDir, $"{name}.d2s");
        var targetCtl = Path.Combine(saveDir, $"{name}.ctl");
        if (File.Exists(targetD2S))
        {
            Console.WriteLine($"Error: Character save file '{targetD2S}' already exists. Aborting to avoid overwrite.");
            return 1;
        }

        var (outputBytes, ctlBytes, err) = CreateMuleBytes(name, charClass, hardcore, excelDir);
        if (err != null || outputBytes == null)
        {
            Console.WriteLine($"Error: {err}");
            return 1;
        }

        try
        {
            // Exclusive creation avoids a race overwriting an existing character.
            using (var stream = new FileStream(targetD2S, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            {
                stream.Write(outputBytes);
                stream.Flush(true);
            }

            // Copy .ctl keybindings template if present
            if (ctlBytes != null)
            {
                if (!File.Exists(targetCtl))
                {
                    using var stream = new FileStream(targetCtl, FileMode.CreateNew, FileAccess.Write, FileShare.None);
                    stream.Write(ctlBytes);
                    stream.Flush(true);
                }
            }

            Console.WriteLine($"[SUCCESS] Created new {matchedClass} character '{name}' at:");
            Console.WriteLine($"  -> {targetD2S} ({outputBytes.Length} bytes)");
            if (ctlBytes != null)
                Console.WriteLine($"  -> {targetCtl}");

            return 0;
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Error writing save files: {ex.Message}");
            return 1;
        }
    }

    public static (byte[]? d2sBytes, byte[]? ctlBytes, string? error) CreateMuleBytes(
        string name,
        string charClass,
        bool hardcore,
        string excelDir,
        string? customTemplateDir = null)
    {
        if (!System.Text.RegularExpressions.Regex.IsMatch(name ?? "", @"^[A-Za-z][A-Za-z_-]{1,14}$"))
            return (null, null, "Use 2–15 ASCII letters, hyphens, or underscores; start with a letter.");

        var matchedClass = ValidClasses.FirstOrDefault(c => c.Equals(charClass, StringComparison.OrdinalIgnoreCase));
        if (matchedClass == null)
            return (null, null, $"Invalid class '{charClass}'. Valid options: {string.Join(", ", ValidClasses)}");

        string baseDir = AppContext.BaseDirectory;
        var templateCandidates = new List<string>();
        if (!string.IsNullOrEmpty(customTemplateDir))
            templateCandidates.Add(Path.Combine(customTemplateDir, $"{matchedClass}_L1.golden.d2s"));
        templateCandidates.AddRange(new[]
        {
            Path.Combine(baseDir, "baselines", $"{matchedClass}_L1.golden.d2s"),
            Path.Combine(baseDir, "tests", "fixtures", "baselines", $"{matchedClass}_L1.golden.d2s"),
            Path.Combine(Directory.GetCurrentDirectory(), "tests", "fixtures", "baselines", $"{matchedClass}_L1.golden.d2s"),
            Path.Combine(baseDir, "..", "..", "..", "tests", "fixtures", "baselines", $"{matchedClass}_L1.golden.d2s"),
        });

        string? templatePath = templateCandidates.FirstOrDefault(File.Exists);
        if (templatePath == null)
            return (null, null, $"Golden baseline fixture for '{matchedClass}' not found.");

        try
        {
            var externalData = new TxtFileExternalData(excelDir, version: 105);
            var templateBytes = File.ReadAllBytes(templatePath);
            var save = D2Save.Read(templateBytes, externalData);

            var rows = File.ReadAllLines(Path.Combine(excelDir, "charstats.txt"));
            var headers = rows[0].Split('\t');
            var classColumn = Array.IndexOf(headers, "class");
            var starting = rows.Skip(1).Select(row => row.Split('\t'))
                .Single(row => classColumn >= 0 && row.Length > classColumn && row[classColumn].Equals(matchedClass, StringComparison.OrdinalIgnoreCase));
            int ReadStat(string column)
            {
                var index = Array.IndexOf(headers, column);
                if (index < 0 || index >= starting.Length || !int.TryParse(starting[index], out var value) || value < 0)
                    throw new InvalidDataException($"Invalid {matchedClass} starting stat: {column}");
                return value;
            }
            save.Stats.SetStat(StatId.Strength, ReadStat("str"), 0);
            save.Stats.SetStat(StatId.Dexterity, ReadStat("dex"), 0);
            save.Stats.SetStat(StatId.Energy, ReadStat("int"), 0);
            save.Stats.SetStat(StatId.Vitality, ReadStat("vit"), 0);
            foreach (var stat in new[] { StatId.Life, StatId.MaxLife })
                save.Stats.SetStat(stat, (ReadStat("vit") + ReadStat("hpadd")) << 8, 0);
            foreach (var stat in new[] { StatId.Mana, StatId.MaxMana })
                save.Stats.SetStat(stat, ReadStat("int") << 8, 0);
            foreach (var stat in new[] { StatId.Stamina, StatId.MaxStamina })
                save.Stats.SetStat(stat, ReadStat("stamina") << 8, 0);

            save.Character.Preview.Name = name!;
            if (hardcore)
                save.Character.Flags |= CharacterFlags.Hardcore;

            var outputBytes = save.ToBytes(externalData, 105);
            var ctlTemplate = Path.ChangeExtension(templatePath, ".ctl");
            byte[]? ctlBytes = File.Exists(ctlTemplate) ? File.ReadAllBytes(ctlTemplate) : null;

            return (outputBytes, ctlBytes, null);
        }
        catch (Exception ex)
        {
            return (null, null, $"Error generating character: {ex.Message}");
        }
    }
}
