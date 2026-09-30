using System;
using System.IO;

namespace D2SItems;

public static class SaveBackup
{
    private static readonly HashSet<string> LiveMainCharacters = new(StringComparer.OrdinalIgnoreCase)
    {
        "Assassin", "Barbarian", "Druid", "Jewlery", "Necromancer", "Paladin", "Sorceress", "Warlock", "Zon"
    };

    /// <summary>
    /// Checks if a character file represents a protected live character.
    /// </summary>
    public static bool IsProtectedLiveCharacter(string filePath)
    {
        var name = Path.GetFileNameWithoutExtension(filePath);
        return LiveMainCharacters.Contains(name);
    }

    /// <summary>
    /// Creates a timestamped backup of a file in a 'backups' subdirectory next to the file.
    /// Returns the backup file path, or null if source file didn't exist.
    /// </summary>
    public static string? CreateBackup(string filePath)
    {
        if (!File.Exists(filePath))
            return null;

        var dir = Path.GetDirectoryName(filePath) ?? ".";
        var backupDir = Path.Combine(dir, "backups");
        Directory.CreateDirectory(backupDir);

        var timestamp = DateTime.UtcNow.ToString("yyyyMMdd_HHmmss_fffffff");
        var fileName = Path.GetFileName(filePath);
        var backupPath = Path.Combine(backupDir, $"{timestamp}_{Guid.NewGuid():N}_{fileName}");

        File.Copy(filePath, backupPath, overwrite: false);
        Console.Error.WriteLine($"[BACKUP] Created safety backup: {backupPath}");
        return backupPath;
    }
}
