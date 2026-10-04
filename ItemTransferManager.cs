using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using D2SSharp.Data;
using D2SSharp.Enums;
using D2SSharp.Model;

namespace D2SItems;

public enum ContainerType
{
    Inventory,
    Stash,
    Cube,
    SharedStash
}

public class ItemTransferRequest
{
    public string SourceFile { get; set; } = "";
    public ContainerType SourceContainer { get; set; } = ContainerType.SharedStash;
    public int SourceTab { get; set; } = 0;
    public int? SourceX { get; set; }
    public int? SourceY { get; set; }
    public uint? ItemSeed { get; set; }
    public string? ItemCode { get; set; }

    public string TargetFile { get; set; } = "";
    public ContainerType TargetContainer { get; set; } = ContainerType.Inventory;
    public int TargetTab { get; set; } = 0;
    public int? TargetX { get; set; }
    public int? TargetY { get; set; }

    public bool ForceLive { get; set; } = false;
    public string ExcelDir { get; set; } = "";
    public string? SourceRevision { get; set; }
    public string? TargetRevision { get; set; }
}

public class TransferResult
{
    public bool Success { get; set; }
    public string Message { get; set; } = "";
    public string? SourceBackup { get; set; }
    public string? TargetBackup { get; set; }
    public string? ItemCode { get; set; }
    public int PlacedX { get; set; }
    public int PlacedY { get; set; }
    public int Width { get; set; }
    public int Height { get; set; }
    public bool IsProtected { get; set; }
}

public class BulkTransferRequest
{
    public string SourceStashFile { get; set; } = "";
    public int SourceTab { get; set; } = 0;
    public string TargetCharFile { get; set; } = "";
    public List<ContainerType> TargetContainers { get; set; } = new() { ContainerType.Inventory, ContainerType.Cube, ContainerType.Stash };
    public string ItemFilter { get; set; } = "all"; // all, runes, gems, charms, uniques, sets
    public List<uint>? ItemSeeds { get; set; }
    public int MaxItems { get; set; } = 100;
    public bool ForceLive { get; set; } = false;
    public string ExcelDir { get; set; } = "";
    public string? SourceRevision { get; set; }
    public string? TargetRevision { get; set; }
}

public class BulkTransferResult
{
    public bool Success { get; set; }
    public string Message { get; set; } = "";
    public int ItemsMoved { get; set; }
    public int ItemsRemaining { get; set; }
    public List<string> MovedItemCodes { get; set; } = new();
    public string? SourceBackup { get; set; }
    public string? TargetBackup { get; set; }
    public bool IsProtected { get; set; }
}

public static class ItemTransferManager
{
    private static bool IsHardcore(D2Save? character, string file)
    {
        if (character != null) return character.Character.Flags.HasFlag(CharacterFlags.Hardcore);
        var name = Path.GetFileName(file);
        if (name.Contains("SharedStashHardCore", StringComparison.OrdinalIgnoreCase)) return true;
        if (name.Contains("SharedStashSoftCore", StringComparison.OrdinalIgnoreCase)) return false;
        throw new ArgumentException("Cannot determine shared stash hardcore/softcore mode from its filename. Use the original game filename.");
    }

    private static void ValidateCore(bool source, bool target)
    {
        if (source != target) throw new ArgumentException("Hardcore and softcore saves cannot exchange items. No items were moved.");
    }
    private static StorePage ContainerTypeToStorePage(ContainerType ct) => ct switch
    {
        ContainerType.Inventory => StorePage.Inventory,
        ContainerType.Stash => StorePage.Stash,
        ContainerType.Cube => StorePage.Cube,
        _ => StorePage.Inventory
    };

    public static TransferResult TransferItem(ItemTransferRequest request)
    {
        // 1. Safety Guard Check
        if (SaveBackup.IsProtectedLiveCharacter(request.SourceFile) && !request.ForceLive)
        {
            var charName = Path.GetFileNameWithoutExtension(request.SourceFile);
            return new TransferResult
            {
                Success = false,
                IsProtected = true,
                Message = $"'{charName}' is a protected live character. Explicit confirmation (--force-live) required."
            };
        }
        if (SaveBackup.IsProtectedLiveCharacter(request.TargetFile) && !request.ForceLive)
        {
            var charName = Path.GetFileNameWithoutExtension(request.TargetFile);
            return new TransferResult
            {
                Success = false,
                IsProtected = true,
                Message = $"'{charName}' is a protected live character. Explicit confirmation (--force-live) required."
            };
        }

        if (!File.Exists(request.SourceFile))
            return new TransferResult { Success = false, Message = $"Source file not found: {request.SourceFile}" };
        if (!File.Exists(request.TargetFile))
            return new TransferResult { Success = false, Message = $"Target file not found: {request.TargetFile}" };

        try
        {
            bool isSameFile = string.Equals(
                Path.GetFullPath(request.SourceFile),
                Path.GetFullPath(request.TargetFile),
                StringComparison.OrdinalIgnoreCase);

            byte[] srcRawBytes = File.ReadAllBytes(request.SourceFile);
            byte[]? dstRawBytes = isSameFile ? null : File.ReadAllBytes(request.TargetFile);

            var (newSrcBytes, newDstBytes, result) = TransferItemBytes(srcRawBytes, dstRawBytes, request, request.ExcelDir);
            if (!result.Success)
                return result;


            var updates = new List<SaveFileTransaction.Update>
            {
                new(request.SourceFile, srcRawBytes, newSrcBytes!)
            };
            if (!isSameFile)
                updates.Add(new(request.TargetFile, dstRawBytes!, newDstBytes!));
            var backups = SaveFileTransaction.Commit(updates.ToArray());
            result.SourceBackup = backups[0];
            result.TargetBackup = isSameFile ? null : backups[1];

            return result;
        }
        catch (Exception ex)
        {
            return new TransferResult
            {
                Success = false,
                Message = $"Transfer failed with exception: {ex.Message}"
            };
        }
    }

    public static (byte[]? newSourceBytes, byte[]? newTargetBytes, TransferResult result) TransferItemBytes(
        byte[] sourceRawBytes,
        byte[]? targetRawBytes,
        ItemTransferRequest request,
        string excelDir)
    {
        try
        {
            SaveFileTransaction.VerifyRevision(sourceRawBytes, request.SourceRevision);
            SaveFileTransaction.VerifyRevision(targetRawBytes ?? sourceRawBytes, request.TargetRevision);
            var dims = ContainerDimensions.LoadFromExcel(excelDir);
            var itemDims = ItemDimensionsLookup.LoadFromExcel(excelDir);
            var externalData = new TxtFileExternalData(excelDir, version: 105);

            bool isSameFile = targetRawBytes == null;

            // Read source
            D2Save? sourceSave = null;
            D2StashSave? sourceStash = null;
            if (request.SourceContainer == ContainerType.SharedStash)
                sourceStash = D2StashSave.Read(sourceRawBytes, externalData);
            else
                sourceSave = D2Save.Read(sourceRawBytes, externalData);

            // Read target
            D2Save? targetSave = null;
            D2StashSave? targetStash = null;
            if (isSameFile)
            {
                targetSave = sourceSave;
                targetStash = sourceStash;
            }
            else
            {
                if (request.TargetContainer == ContainerType.SharedStash)
                    targetStash = D2StashSave.Read(targetRawBytes!, externalData);
                else
                    targetSave = D2Save.Read(targetRawBytes!, externalData);
            }

            if (!isSameFile)
                ValidateCore(IsHardcore(sourceSave, request.SourceFile), IsHardcore(targetSave, request.TargetFile));

            // Find source item
            Item? itemToMove = null;
            if (request.SourceContainer == ContainerType.SharedStash)
            {
                if (sourceStash == null || request.SourceTab < 0 || request.SourceTab >= sourceStash.Count)
                    return (null, null, new TransferResult { Success = false, Message = $"Invalid source stash tab: {request.SourceTab}" });

                var tab = sourceStash[request.SourceTab];
                itemToMove = FindItem(tab.Items, request.SourceX, request.SourceY, request.ItemSeed, request.ItemCode);
            }
            else
            {
                if (sourceSave == null)
                    return (null, null, new TransferResult { Success = false, Message = "Source character save not loaded." });

                var srcPage = ContainerTypeToStorePage(request.SourceContainer);
                var candidateItems = sourceSave.Items.Where(i => i.Position.Mode == ItemMode.Stored && i.Position.StorePage == srcPage);
                itemToMove = FindItem(candidateItems, request.SourceX, request.SourceY, request.ItemSeed, request.ItemCode);
            }

            if (itemToMove == null)
                return (null, null, new TransferResult { Success = false, Message = "Item to move was not found in source container." });

            bool sourceAdvanced = sourceStash != null && sourceStash[request.SourceTab].TabType == StashTabType.AdvancedStash;
            bool targetAdvanced = targetStash != null && request.TargetTab >= 0 && request.TargetTab < targetStash.Count
                && targetStash[request.TargetTab].TabType == StashTabType.AdvancedStash;
            if (sourceStash != null && sourceStash[request.SourceTab].TabType == StashTabType.Chronicle
                || targetStash != null && request.TargetTab >= 0 && request.TargetTab < targetStash.Count
                    && targetStash[request.TargetTab].TabType == StashTabType.Chronicle)
                throw new ArgumentException("Chronicle tabs are not item containers.");
            if (sourceAdvanced && (itemToMove.AdvancedStashStackSize ?? 0) == 0)
                throw new ArgumentException("The selected advanced stash stack is empty.");
            if (targetAdvanced)
            {
                if (isSameFile && request.SourceContainer == ContainerType.SharedStash && request.SourceTab == request.TargetTab)
                    throw new ArgumentException("Item is already in this advanced stash.");
                var code = itemToMove.ItemCodeString.Trim();
                bool allowed = GameDataTables.IsAdvancedBankItem(code, excelDir);
                if (!allowed) throw new ArgumentException($"BKDiablo has no advanced-stash slot for {code}.");
                var destination = targetStash![request.TargetTab].Items.Where(i => i.ItemCodeString.Trim() == code).ToList();
                if (destination.Count > 1) throw new ArgumentException("Ambiguous destination stack; reload the stash.");
                if (!sourceAdvanced && itemToMove.Quantity > 1)
                    throw new ArgumentException("Native quantity stacks require an explicit split before depositing.");
                int amount = sourceAdvanced ? itemToMove.AdvancedStashStackSize!.Value : 1;
                int existing = destination.Count == 1 ? destination[0].AdvancedStashStackSize ?? 0 : 0;
                if (existing + amount > 255) throw new ArgumentException("Destination stack would exceed 255; withdraw items first.");
                if (sourceStash != null) sourceStash[request.SourceTab].Items.Remove(itemToMove);
                else sourceSave!.Items.Remove(itemToMove);
                if (destination.Count == 1) destination[0].AdvancedStashStackSize = (byte)(existing + amount);
                else
                {
                    itemToMove.AdvancedStashStackSize = (byte)amount;
                    itemToMove.Position.Mode = ItemMode.Stored;
                    itemToMove.Position.StorePage = StorePage.Stash;
                    itemToMove.Position.InvX = 0;
                    itemToMove.Position.InvY = 0;
                    targetStash[request.TargetTab].Items.Add(itemToMove);
                }
                return (sourceStash != null ? sourceStash.ToBytes(externalData, 105) : sourceSave!.ToBytes(externalData, 105),
                    isSameFile ? null : targetStash.ToBytes(externalData, 105),
                    new TransferResult { Success = true, ItemCode = code, Message = $"Deposited {amount} {code}; stack now {existing + amount}." });
            }
            Item? sourceStack = null;
            if (sourceAdvanced)
            {
                // Withdrawing to an ordinary grid splits off one complete item.
                sourceStack = itemToMove;
                var copy = D2StashSave.Read(sourceRawBytes, externalData);
                itemToMove = FindItem(copy[request.SourceTab].Items, request.SourceX, request.SourceY, request.ItemSeed, request.ItemCode)!;
                itemToMove.AdvancedStashStackSize = 0;
            }

            var (itemW, itemH) = itemDims.GetSize(itemToMove.ItemCodeString);

            // Check destination grid space
            ContainerGrid2D targetGrid;
            Item? excludeItem = isSameFile && request.SourceContainer == request.TargetContainer ? itemToMove : null;

            if (request.TargetContainer == ContainerType.SharedStash)
            {
                if (targetStash == null || request.TargetTab < 0 || request.TargetTab >= targetStash.Count)
                    return (null, null, new TransferResult { Success = false, Message = $"Invalid target stash tab: {request.TargetTab}" });

                targetGrid = ContainerGrid2D.BuildSharedStashGrid(targetStash[request.TargetTab], dims, itemDims, excludeItem);
            }
            else
            {
                if (targetSave == null)
                    return (null, null, new TransferResult { Success = false, Message = "Target character save not loaded." });

                var dstPage = ContainerTypeToStorePage(request.TargetContainer);
                targetGrid = ContainerGrid2D.BuildCharacterGrid(targetSave, dstPage, dims, itemDims, excludeItem);
            }

            int finalX, finalY;
            if (request.TargetX.HasValue && request.TargetY.HasValue)
            {
                finalX = request.TargetX.Value;
                finalY = request.TargetY.Value;
                if (!targetGrid.CanPlace(finalX, finalY, itemW, itemH))
                {
                    return (null, null, new TransferResult
                    {
                        Success = false,
                        Message = $"Target slot ({finalX}, {finalY}) is occupied or out of bounds for item {itemToMove.ItemCodeString} ({itemW}x{itemH})."
                    });
                }
            }
            else
            {
                var slot = targetGrid.FindFirstAvailableSlot(itemW, itemH);
                if (!slot.HasValue)
                {
                    return (null, null, new TransferResult
                    {
                        Success = false,
                        Message = $"Target container has no available space for item {itemToMove.ItemCodeString} ({itemW}x{itemH})."
                    });
                }
                finalX = slot.Value.X;
                finalY = slot.Value.Y;
            }

            // Remove from source
            if (request.SourceContainer == ContainerType.SharedStash)
            {
                if (sourceStack != null) sourceStack.AdvancedStashStackSize--;
                else sourceStash![request.SourceTab].Items.Remove(itemToMove);
            }
            else
            {
                sourceSave!.Items.Remove(itemToMove);
            }

            // Update item position
            itemToMove.Position.Mode = ItemMode.Stored;
            itemToMove.Position.BodyLocation = BodyLocation.None;
            itemToMove.Position.InvX = (byte)finalX;
            itemToMove.Position.InvY = (byte)finalY;

            // Add to target
            if (request.TargetContainer == ContainerType.SharedStash)
            {
                itemToMove.Position.StorePage = StorePage.Stash;
                targetStash![request.TargetTab].Items.Add(itemToMove);
            }
            else
            {
                itemToMove.Position.StorePage = ContainerTypeToStorePage(request.TargetContainer);
                targetSave!.Items.Add(itemToMove);
            }

            // Serialize outputs
            byte[] outSrcBytes;
            byte[]? outDstBytes = null;

            if (isSameFile)
            {
                outSrcBytes = request.SourceContainer == ContainerType.SharedStash
                    ? sourceStash!.ToBytes(externalData, 105)
                    : sourceSave!.ToBytes(externalData, 105);
            }
            else
            {
                outSrcBytes = request.SourceContainer == ContainerType.SharedStash
                    ? sourceStash!.ToBytes(externalData, 105)
                    : sourceSave!.ToBytes(externalData, 105);

                outDstBytes = request.TargetContainer == ContainerType.SharedStash
                    ? targetStash!.ToBytes(externalData, 105)
                    : targetSave!.ToBytes(externalData, 105);
            }

            return (outSrcBytes, outDstBytes, new TransferResult
            {
                Success = true,
                Message = $"Successfully transferred {itemToMove.ItemCodeString.Trim()} to ({finalX}, {finalY}) in {request.TargetContainer}.",
                ItemCode = itemToMove.ItemCodeString.Trim(),
                PlacedX = finalX,
                PlacedY = finalY,
                Width = itemW,
                Height = itemH
            });
        }
        catch (Exception ex)
        {
            return (null, null, new TransferResult
            {
                Success = false,
                Message = $"Transfer failed with exception: {ex.Message}"
            });
        }
    }

    public static BulkTransferResult FillCharacterFromStash(BulkTransferRequest request)
    {
        if (SaveBackup.IsProtectedLiveCharacter(request.TargetCharFile) && !request.ForceLive)
        {
            var charName = Path.GetFileNameWithoutExtension(request.TargetCharFile);
            return new BulkTransferResult
            {
                Success = false,
                IsProtected = true,
                Message = $"'{charName}' is a protected live character. Explicit confirmation (--force-live) required."
            };
        }

        if (!File.Exists(request.SourceStashFile))
            return new BulkTransferResult { Success = false, Message = $"Source stash file not found: {request.SourceStashFile}" };
        if (!File.Exists(request.TargetCharFile))
            return new BulkTransferResult { Success = false, Message = $"Target character file not found: {request.TargetCharFile}" };

        try
        {
            var stashBytes = File.ReadAllBytes(request.SourceStashFile);
            var charBytes = File.ReadAllBytes(request.TargetCharFile);

            var (newStashBytes, newCharBytes, result) = BulkTransferBytes(stashBytes, charBytes, request, request.ExcelDir);
            if (!result.Success)
                return result;
            if (result.ItemsMoved == 0) return result;

            var backups = SaveFileTransaction.Commit(
                new(request.SourceStashFile, stashBytes, newStashBytes!),
                new(request.TargetCharFile, charBytes, newCharBytes!));
            result.SourceBackup = backups[0];
            result.TargetBackup = backups[1];

            return result;
        }
        catch (Exception ex)
        {
            return new BulkTransferResult
            {
                Success = false,
                Message = $"Bulk transfer failed with exception: {ex.Message}"
            };
        }
    }

    public static (byte[]? newStashBytes, byte[]? newCharBytes, BulkTransferResult result) BulkTransferBytes(
        byte[] sourceStashBytes,
        byte[] targetCharBytes,
        BulkTransferRequest request,
        string excelDir)
    {
        try
        {
            try { SaveFileTransaction.VerifyRevision(sourceStashBytes, request.SourceRevision); }
            catch (IOException) { return (null, null, new BulkTransferResult { Success = false, Message = "The source shared stash changed since scanning. Close the game, reopen Pack Mule to refresh the saves, and review your selection before retrying. No items were moved." }); }
            try { SaveFileTransaction.VerifyRevision(targetCharBytes, request.TargetRevision); }
            catch (IOException) { return (null, null, new BulkTransferResult { Success = false, Message = "The destination character changed since scanning. Close the game, reopen Pack Mule to refresh the saves, and review your selection before retrying. No items were moved." }); }
            var dims = ContainerDimensions.LoadFromExcel(excelDir);
            var itemDims = ItemDimensionsLookup.LoadFromExcel(excelDir);
            var externalData = new TxtFileExternalData(excelDir, version: 105);

            var stash = D2StashSave.Read(sourceStashBytes, externalData);
            var save = D2Save.Read(targetCharBytes, externalData);
            ValidateCore(IsHardcore(null, request.SourceStashFile), IsHardcore(save, request.TargetCharFile));

            if (request.SourceTab < 0 || request.SourceTab >= stash.Count)
                return (null, null, new BulkTransferResult { Success = false, Message = $"Invalid stash tab {request.SourceTab}" });

            var sourceTab = stash[request.SourceTab];
            if (sourceTab.TabType != StashTabType.Normal)
                throw new ArgumentException("Bulk packing requires a normal stash tab; withdraw advanced stacks individually.");
            var candidateItems = new List<Item>();

            if (request.ItemSeeds != null && request.ItemSeeds.Count > 0)
            {
                var seedSet = new HashSet<uint>(request.ItemSeeds);
                candidateItems.AddRange(sourceTab.Items.Where(i => seedSet.Contains(i.ItemSeed)));
            }
            else
            {
                foreach (var it in sourceTab.Items)
                {
                    if (MatchesFilter(it, request.ItemFilter))
                        candidateItems.Add(it);
                }
            }

            if (candidateItems.Count == 0)
                return (null, null, new BulkTransferResult { Success = true, Message = "No matching items found in stash tab to transfer.", ItemsMoved = 0 });

            // Determine if character has Horadric Cube
            bool hasCube = save.Items.Any(i => i.ItemCodeString.Trim().Equals("box", StringComparison.OrdinalIgnoreCase));

            // Plan transfers into target containers in order: Inventory -> Cube -> Stash
            var containersToUse = new List<StorePage>();
            foreach (var ct in request.TargetContainers)
            {
                if (ct == ContainerType.Inventory) containersToUse.Add(StorePage.Inventory);
                else if (ct == ContainerType.Cube && hasCube) containersToUse.Add(StorePage.Cube);
                else if (ct == ContainerType.Stash) containersToUse.Add(StorePage.Stash);
            }

            var movedItems = new List<(Item Item, StorePage Page, int X, int Y)>();
            var grids = containersToUse.ToDictionary(
                p => p,
                p => ContainerGrid2D.BuildCharacterGrid(save, p, dims, itemDims)
            );

            foreach (var item in candidateItems)
            {
                if (movedItems.Count >= request.MaxItems) break;

                var (w, h) = itemDims.GetSize(item.ItemCodeString);
                bool placed = false;

                foreach (var page in containersToUse)
                {
                    var grid = grids[page];
                    var slot = grid.FindFirstAvailableSlot(w, h);
                    if (slot.HasValue)
                    {
                        grid.MarkOccupied(slot.Value.X, slot.Value.Y, w, h);
                        movedItems.Add((item, page, slot.Value.X, slot.Value.Y));
                        placed = true;
                        break;
                    }
                }

                if (!placed)
                {
                    break;
                }
            }

            if (movedItems.Count == 0)
            {
                return (null, null, new BulkTransferResult
                {
                    Success = false,
                    Message = "No space available in any target container for the requested items.",
                    ItemsMoved = 0,
                    ItemsRemaining = candidateItems.Count
                });
            }

            var movedCodes = new List<string>();
            foreach (var (item, page, x, y) in movedItems)
            {
                sourceTab.Items.Remove(item);
                item.Position.Mode = ItemMode.Stored;
                item.Position.BodyLocation = BodyLocation.None;
                item.Position.StorePage = page;
                item.Position.InvX = (byte)x;
                item.Position.InvY = (byte)y;
                save.Items.Add(item);
                movedCodes.Add(item.ItemCodeString.Trim());
            }

            byte[] newStashBytes = stash.ToBytes(externalData, 105);
            byte[] newCharBytes = save.ToBytes(externalData, 105);

            int remaining = candidateItems.Count - movedItems.Count;
            return (newStashBytes, newCharBytes, new BulkTransferResult
            {
                Success = true,
                Message = $"Successfully packed {movedItems.Count} items. ({remaining} items remained in stash)",
                ItemsMoved = movedItems.Count,
                ItemsRemaining = remaining,
                MovedItemCodes = movedCodes
            });
        }
        catch (Exception ex)
        {
            return (null, null, new BulkTransferResult
            {
                Success = false,
                Message = $"Bulk transfer failed with exception: {ex.Message}"
            });
        }
    }

    private static bool MatchesFilter(Item item, string filter)
    {
        var code = item.ItemCodeString.Trim();
        return filter.ToLowerInvariant() switch
        {
            "runes" => code.StartsWith("r", StringComparison.OrdinalIgnoreCase) && code.Length == 3 && char.IsDigit(code[1]),
            "gems" => code.Length == 3 && (code.StartsWith("g", StringComparison.OrdinalIgnoreCase) || code.StartsWith("sk", StringComparison.OrdinalIgnoreCase)),
            "charms" => code.StartsWith("cm", StringComparison.OrdinalIgnoreCase),
            "uniques" => item.Quality == ItemQuality.Unique,
            "sets" => item.Quality == ItemQuality.Set,
            "all" => true,
            _ => true
        };
    }

    private static Item? FindItem(IEnumerable<Item> items, int? x, int? y, uint? seed, string? code)
    {
        var matches = items.Where(item =>
            (!seed.HasValue || item.ItemSeed == seed.Value)
            && (!x.HasValue || item.Position.InvX == x.Value)
            && (!y.HasValue || item.Position.InvY == y.Value)
            && (string.IsNullOrWhiteSpace(code) || item.ItemCodeString.Trim().Equals(code.Trim(), StringComparison.OrdinalIgnoreCase)))
            .Take(2).ToList();
        return (seed.HasValue || (x.HasValue && y.HasValue)) && matches.Count == 1 ? matches[0] : null;
    }

    public static int RunCli(string[] args, string defaultSaveDir, string excelDir)
    {
        if (args.Length < 1) return 1;
        var subCmd = args[0].ToLowerInvariant();

        if (subCmd == "transfer-item")
        {
            ItemTransferRequest req;
            if (args.Length >= 2 && args[1] == "--json-stdin")
            {
                var json = Console.In.ReadToEnd();
                var options = new JsonSerializerOptions { PropertyNameCaseInsensitive = true, Converters = { new System.Text.Json.Serialization.JsonStringEnumConverter() } };
                req = JsonSerializer.Deserialize<ItemTransferRequest>(json, options) ?? new ItemTransferRequest();
                req.ExcelDir = excelDir;
            }
            else
            {
                req = new ItemTransferRequest { ExcelDir = excelDir };
                for (int i = 1; i < args.Length; i++)
                {
                    switch (args[i].ToLowerInvariant())
                    {
                        case "--from-file": req.SourceFile = args[++i]; break;
                        case "--from-container":
                            req.SourceContainer = ParseContainerType(args[++i]);
                            break;
                        case "--from-tab": req.SourceTab = int.Parse(args[++i]); break;
                        case "--from-x": req.SourceX = int.Parse(args[++i]); break;
                        case "--from-y": req.SourceY = int.Parse(args[++i]); break;
                        case "--seed": req.ItemSeed = uint.Parse(args[++i]); break;
                        case "--code": req.ItemCode = args[++i]; break;
                        case "--to-file": req.TargetFile = args[++i]; break;
                        case "--to-container":
                            req.TargetContainer = ParseContainerType(args[++i]);
                            break;
                        case "--to-tab": req.TargetTab = int.Parse(args[++i]); break;
                        case "--to-x": req.TargetX = int.Parse(args[++i]); break;
                        case "--to-y": req.TargetY = int.Parse(args[++i]); break;
                        case "--source-revision": req.SourceRevision = args[++i]; break;
                        case "--target-revision": req.TargetRevision = args[++i]; break;
                        case "--force-live": req.ForceLive = true; break;
                    }
                }
            }

            // Resolve relative paths with defaultSaveDir
            if (!string.IsNullOrEmpty(req.SourceFile) && !Path.IsPathRooted(req.SourceFile))
                req.SourceFile = Path.Combine(defaultSaveDir, req.SourceFile);
            if (!string.IsNullOrEmpty(req.TargetFile) && !Path.IsPathRooted(req.TargetFile))
                req.TargetFile = Path.Combine(defaultSaveDir, req.TargetFile);

            var res = TransferItem(req);
            Console.WriteLine(JsonSerializer.Serialize(res, new JsonSerializerOptions { WriteIndented = true }));
            return res.Success ? 0 : 1;
        }
        else if (subCmd == "fill-mule")
        {
            var req = new BulkTransferRequest { ExcelDir = excelDir };
            for (int i = 1; i < args.Length; i++)
            {
                switch (args[i].ToLowerInvariant())
                {
                    case "--stash": req.SourceStashFile = args[++i]; break;
                    case "--tab": req.SourceTab = int.Parse(args[++i]); break;
                    case "--char": req.TargetCharFile = args[++i]; break;
                    case "--filter": req.ItemFilter = args[++i]; break;
                    case "--max": req.MaxItems = int.Parse(args[++i]); break;
                    case "--source-revision": req.SourceRevision = args[++i]; break;
                    case "--target-revision": req.TargetRevision = args[++i]; break;
                    case "--force-live": req.ForceLive = true; break;
                }
            }

            if (!string.IsNullOrEmpty(req.SourceStashFile) && !Path.IsPathRooted(req.SourceStashFile))
                req.SourceStashFile = Path.Combine(defaultSaveDir, req.SourceStashFile);
            if (!string.IsNullOrEmpty(req.TargetCharFile) && !Path.IsPathRooted(req.TargetCharFile))
                req.TargetCharFile = Path.Combine(defaultSaveDir, req.TargetCharFile);

            var res = FillCharacterFromStash(req);
            Console.WriteLine(JsonSerializer.Serialize(res, new JsonSerializerOptions { WriteIndented = true }));
            return res.Success ? 0 : 1;
        }

        return 1;
    }

    private static ContainerType ParseContainerType(string s) => s.ToLowerInvariant() switch
    {
        "sharedstash" or "shared-stash" or "stash-tab" => ContainerType.SharedStash,
        "inventory" or "inv" => ContainerType.Inventory,
        "stash" or "bank" or "personal-stash" or "personal_stash" => ContainerType.Stash,
        "cube" or "horadric" or "horadric-cube" => ContainerType.Cube,
        _ => throw new ArgumentException($"Unknown container: {s}")
    };
}
