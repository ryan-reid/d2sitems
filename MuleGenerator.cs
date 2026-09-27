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

        // Locate baseline fixture template
        string baseDir = AppContext.BaseDirectory;
        string[] templateCandidates = new[]
        {
            Path.Combine(baseDir, "tests", "fixtures", "baselines", $"{matchedClass}_L1.golden.d2s"),
            Path.Combine(Directory.GetCurrentDirectory(), "tests", "fixtures", "baselines", $"{matchedClass}_L1.golden.d2s"),
            Path.Combine(baseDir, "..", "..", "..", "tests", "fixtures", "baselines", $"{matchedClass}_L1.golden.d2s"),
        };

        string? templatePath = templateCandidates.FirstOrDefault(File.Exists);
        if (templatePath == null)
        {
            Console.WriteLine($"Error: Golden baseline fixture for '{matchedClass}' not found.");
            Console.WriteLine($"Checked paths:\n  {string.Join("\n  ", templateCandidates)}");
            return 1;
        }

        try
        {
            var externalData = new TxtFileExternalData(excelDir, version: 105);
            var templateBytes = File.ReadAllBytes(templatePath);
            var save = D2Save.Read(templateBytes, externalData);

            // Update character name and flags
            save.Character.Preview.Name = name;
            if (hardcore)
            {
                save.Character.Flags |= CharacterFlags.Hardcore;
            }

            var outputBytes = save.ToBytes(externalData, 105);

            // Write .d2s
            File.WriteAllBytes(targetD2S, outputBytes);

            // Copy .ctl keybindings template if present
            var ctlTemplate = Path.ChangeExtension(templatePath, ".ctl");
            if (File.Exists(ctlTemplate))
            {
                File.Copy(ctlTemplate, targetCtl, overwrite: false);
            }

            Console.WriteLine($"[SUCCESS] Created new {matchedClass} character '{name}' at:");
            Console.WriteLine($"  -> {targetD2S} ({outputBytes.Length} bytes)");
            if (File.Exists(targetCtl))
                Console.WriteLine($"  -> {targetCtl}");

            return 0;
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Error generating character: {ex.Message}");
            return 1;
        }
    }
}
