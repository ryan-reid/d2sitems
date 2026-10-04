using System.Text.Json;
namespace D2SItems;

public static class EditWorkspaceCli
{
    public static int Run(string action, string excel)
    {
        try
        {
            var input = JsonDocument.Parse(Console.In.ReadToEnd()).RootElement;
            if (action == "commit-workspace")
            {
                if (System.Diagnostics.Process.GetProcessesByName("D2R").Length != 0) throw new IOException("Close Diablo II before saving edits.");
                var updates = input.GetProperty("updates").EnumerateArray().Select(row => new SaveFileTransaction.Update(
                    row.GetProperty("path").GetString()!,
                    row.GetProperty("original").ValueKind == JsonValueKind.Null ? null : row.GetProperty("original").GetBytesFromBase64(),
                    File.ReadAllBytes(row.GetProperty("staged").GetString()!))).ToArray();
                var backups = SaveFileTransaction.Commit(updates);
                Console.WriteLine(JsonSerializer.Serialize(new { success = true, backups }));
            }
            else
            {
                var folder = input.GetProperty("folder").GetString()!;
                var files = Directory.GetFiles(folder).Where(p => p.EndsWith(".d2s") || p.EndsWith(".d2i") || p.EndsWith(".ctl"))
                    .ToDictionary(p => Path.GetFileName(p), File.ReadAllBytes);
                var plan = JsonSerializer.Deserialize<MulePackingPlan>(input.GetProperty("plan").GetRawText(), new JsonSerializerOptions { PropertyNameCaseInsensitive = true })!;
                var result = MulePackingPlanner.Plan(files, plan, excel);
                foreach (var (file, bytes) in result.Files) File.WriteAllBytes(Path.Combine(folder, file), bytes);
                Console.WriteLine(JsonSerializer.Serialize(new { success = true, moved = result.Moved, remaining = result.Remaining, created = result.Created }));
            }
            return 0;
        }
        catch (Exception error) { Console.WriteLine(JsonSerializer.Serialize(new { success = false, error = error.Message })); return 1; }
    }
}
