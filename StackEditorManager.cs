using System;
using System.IO;
using System.Linq;
using System.Text.Json;
using D2SSharp.Data;
using D2SSharp.Enums;
using D2SSharp.Model;

namespace D2SItems;

public class EditStackRequest
{
    public string StashFile { get; set; } = "";
    public int TabIndex { get; set; } = -1;
    public string ItemCode { get; set; } = "";
    public uint? ItemSeed { get; set; }
    public int Quantity { get; set; } = 1;
    public string ExcelDir { get; set; } = "";
    public string? Revision { get; set; }
}

public class EditStackResult
{
    public bool Success { get; set; }
    public string Message { get; set; } = "";
    public string? BackupPath { get; set; }
    public string ItemCode { get; set; } = "";
    public int NewQuantity { get; set; }
    public int TabIndex { get; set; }
}

public static class StackEditorManager
{
    public static (byte[]? newStashBytes, EditStackResult result) EditStackBytes(
        byte[] rawBytes,
        EditStackRequest request,
        string excelDir)
    {
        try
        {
            SaveFileTransaction.VerifyRevision(rawBytes, request.Revision);
            var externalData = new TxtFileExternalData(excelDir, version: 105);
            var stash = D2StashSave.Read(rawBytes, externalData);

            if (request.TabIndex < 0 || request.TabIndex >= stash.Count)
            {
                return (null, new EditStackResult
                {
                    Success = false,
                    Message = $"Invalid stash tab index: {request.TabIndex} (Stash has {stash.Count} tabs)."
                });
            }

            var tab = stash[request.TabIndex];
            if (tab.TabType != StashTabType.AdvancedStash)
                throw new ArgumentException("Quantity editing is only supported in the advanced stash.");
            var code = (request.ItemCode ?? "").Trim().ToLowerInvariant();
            if (request.Quantity < 1 || request.Quantity > 255)
                throw new ArgumentException("Stack quantity must be between 1 and 255. Deletion is a separate operation.");
            if (!request.ItemSeed.HasValue || string.IsNullOrEmpty(code))
                throw new ArgumentException("An exact item code and seed are required; reload the stash.");
            var matches = tab.Items.Where(i => i.ItemSeed == request.ItemSeed.Value
                && i.ItemCodeString.Trim().Equals(code, StringComparison.OrdinalIgnoreCase)).ToList();
            if (matches.Count != 1)
                throw new ArgumentException("The selected item is missing or ambiguous; reload the stash.");
            var targetItem = matches[0];
            if (!targetItem.AdvancedStashStackSize.HasValue)
                throw new ArgumentException("This item is not an advanced-stash stack.");
            if (!GameDataTables.IsAdvancedBankItem(code, excelDir))
                throw new ArgumentException("BKDiablo has no advanced-stash slot for this item.");
            byte targetQty = (byte)request.Quantity;
            targetItem.AdvancedStashStackSize = targetQty;

            byte[] outBytes = stash.ToBytes(externalData, 105);
            return (outBytes, new EditStackResult
            {
                Success = true,
                Message = $"Successfully set '{request.ItemCode}' stack quantity to {targetQty} in tab {request.TabIndex + 1}.",
                ItemCode = request.ItemCode ?? "",
                NewQuantity = targetQty,
                TabIndex = request.TabIndex
            });
        }
        catch (Exception ex)
        {
            return (null, new EditStackResult
            {
                Success = false,
                Message = $"Failed to edit stack quantity: {ex.Message}",
                ItemCode = request.ItemCode ?? "",
                TabIndex = request.TabIndex
            });
        }
    }

    public static EditStackResult EditStack(EditStackRequest request)
    {
        if (!File.Exists(request.StashFile))
        {
            return new EditStackResult
            {
                Success = false,
                Message = $"Shared stash file not found: {request.StashFile}"
            };
        }

        try
        {
            byte[] rawBytes = File.ReadAllBytes(request.StashFile);
            var (newBytes, result) = EditStackBytes(rawBytes, request, request.ExcelDir);

            if (!result.Success || newBytes == null)
                return result;

            result.BackupPath = SaveFileTransaction.Commit(
                new SaveFileTransaction.Update(request.StashFile, rawBytes, newBytes))[0];
            return result;
        }
        catch (Exception ex)
        {
            return new EditStackResult
            {
                Success = false,
                Message = $"Failed to write modified stash: {ex.Message}"
            };
        }
    }

    public static int RunCli(string[] args, string defaultSaveDir, string excelDir)
    {
        var req = new EditStackRequest { ExcelDir = excelDir };
        for (int i = 1; i < args.Length; i++)
        {
            switch (args[i].ToLowerInvariant())
            {
                case "--file": req.StashFile = args[++i]; break;
                case "--tab": req.TabIndex = int.Parse(args[++i]); break;
                case "--code": req.ItemCode = args[++i]; break;
                case "--seed": req.ItemSeed = uint.Parse(args[++i]); break;
                case "--qty":
                case "--quantity": req.Quantity = int.Parse(args[++i]); break;
                case "--revision": req.Revision = args[++i]; break;
                case "--excel": req.ExcelDir = args[++i]; break;
            }
        }

        var result = EditStack(req);
        Console.WriteLine(JsonSerializer.Serialize(result, new JsonSerializerOptions { WriteIndented = true }));
        return result.Success ? 0 : 1;
    }
}
