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
            var dims = ContainerDimensions.LoadFromExcel(request.ExcelDir);
            var itemDims = ItemDimensionsLookup.LoadFromExcel(request.ExcelDir);
            var externalData = new TxtFileExternalData(request.ExcelDir, version: 105);

            bool isSameFile = string.Equals(
                Path.GetFullPath(request.SourceFile),
                Path.GetFullPath(request.TargetFile),
                StringComparison.OrdinalIgnoreCase);

            // Read source
            D2Save? sourceSave = null;
            D2StashSave? sourceStash = null;
            if (request.SourceContainer == ContainerType.SharedStash)
                sourceStash = D2StashSave.Read(File.ReadAllBytes(request.SourceFile), externalData);
            else
                sourceSave = D2Save.Read(File.ReadAllBytes(request.SourceFile), externalData);

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
                    targetStash = D2StashSave.Read(File.ReadAllBytes(request.TargetFile), externalData);
                else
                    targetSave = D2Save.Read(File.ReadAllBytes(request.TargetFile), externalData);
            }

            // Find source item
            Item? itemToMove = null;
            if (request.SourceContainer == ContainerType.SharedStash)
            {
                if (sourceStash == null || request.SourceTab < 0 || request.SourceTab >= sourceStash.Count)
                    return new TransferResult { Success = false, Message = $"Invalid source stash tab: {request.SourceTab}" };

                var tab = sourceStash[request.SourceTab];
                itemToMove = FindItem(tab.Items, request.SourceX, request.SourceY, request.ItemSeed, request.ItemCode);
            }
            else
            {
                if (sourceSave == null)
                    return new TransferResult { Success = false, Message = "Source character save not loaded." };

                var srcPage = ContainerTypeToStorePage(request.SourceContainer);
                var candidateItems = sourceSave.Items.Where(i => i.Position.Mode == ItemMode.Stored && i.Position.StorePage == srcPage);
                itemToMove = FindItem(candidateItems, request.SourceX, request.SourceY, request.ItemSeed, request.ItemCode);
            }

            if (itemToMove == null)
                return new TransferResult { Success = false, Message = "Item to move was not found in source container." };

            var (itemW, itemH) = itemDims.GetSize(itemToMove.ItemCodeString);

            // Check destination grid space
            ContainerGrid2D targetGrid;
            Item? excludeItem = isSameFile && request.SourceContainer == request.TargetContainer ? itemToMove : null;

            if (request.TargetContainer == ContainerType.SharedStash)
            {
                if (targetStash == null || request.TargetTab < 0 || request.TargetTab >= targetStash.Count)
                    return new TransferResult { Success = false, Message = $"Invalid target stash tab: {request.TargetTab}" };

                targetGrid = ContainerGrid2D.BuildSharedStashGrid(targetStash[request.TargetTab], dims, itemDims, excludeItem);
            }
            else
            {
                if (targetSave == null)
                    return new TransferResult { Success = false, Message = "Target character save not loaded." };

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
                    return new TransferResult
                    {
                        Success = false,
                        Message = $"Target slot ({finalX}, {finalY}) is occupied or out of bounds for item {itemToMove.ItemCodeString} ({itemW}x{itemH})."
                    };
                }
            }
            else
            {
                var slot = targetGrid.FindFirstAvailableSlot(itemW, itemH);
                if (!slot.HasValue)
                {
                    return new TransferResult
                    {
                        Success = false,
                        Message = $"Target container has no available space for item {itemToMove.ItemCodeString} ({itemW}x{itemH})."
                    };
                }
                finalX = slot.Value.X;
                finalY = slot.Value.Y;
            }

            // Create timestamped safety backups
            var srcBackup = SaveBackup.CreateBackup(request.SourceFile);
            string? dstBackup = null;
            if (!isSameFile)
                dstBackup = SaveBackup.CreateBackup(request.TargetFile);

            // Remove from source
            if (request.SourceContainer == ContainerType.SharedStash)
            {
                sourceStash![request.SourceTab].Items.Remove(itemToMove);
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

            // Write files atomically
            if (isSameFile)
            {
                byte[] bytes = request.SourceContainer == ContainerType.SharedStash
                    ? sourceStash!.ToBytes(externalData, 105)
                    : sourceSave!.ToBytes(externalData, 105);
                File.WriteAllBytes(request.SourceFile, bytes);
            }
            else
            {
                byte[] srcBytes = request.SourceContainer == ContainerType.SharedStash
                    ? sourceStash!.ToBytes(externalData, 105)
                    : sourceSave!.ToBytes(externalData, 105);
                File.WriteAllBytes(request.SourceFile, srcBytes);

                byte[] dstBytes = request.TargetContainer == ContainerType.SharedStash
                    ? targetStash!.ToBytes(externalData, 105)
                    : targetSave!.ToBytes(externalData, 105);
                File.WriteAllBytes(request.TargetFile, dstBytes);
            }

            return new TransferResult
            {
                Success = true,
                Message = $"Successfully transferred {itemToMove.ItemCodeString.Trim()} to ({finalX}, {finalY}) in {request.TargetContainer}.",
                SourceBackup = srcBackup,
                TargetBackup = dstBackup,
                ItemCode = itemToMove.ItemCodeString.Trim(),
                PlacedX = finalX,
                PlacedY = finalY,
                Width = itemW,
                Height = itemH
            };
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
            var dims = ContainerDimensions.LoadFromExcel(request.ExcelDir);
            var itemDims = ItemDimensionsLookup.LoadFromExcel(request.ExcelDir);
            var externalData = new TxtFileExternalData(request.ExcelDir, version: 105);

            var stash = D2StashSave.Read(File.ReadAllBytes(request.SourceStashFile), externalData);
            var save = D2Save.Read(File.ReadAllBytes(request.TargetCharFile), externalData);

            if (request.SourceTab < 0 || request.SourceTab >= stash.Count)
                return new BulkTransferResult { Success = false, Message = $"Invalid stash tab {request.SourceTab}" };

            var sourceTab = stash[request.SourceTab];
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
                return new BulkTransferResult { Success = true, Message = "No matching items found in stash tab to transfer.", ItemsMoved = 0 };

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
                    // Target containers are full
                    break;
                }
            }

            if (movedItems.Count == 0)
            {
                return new BulkTransferResult
                {
                    Success = false,
                    Message = "No space available in any target container for the requested items.",
                    ItemsMoved = 0,
                    ItemsRemaining = candidateItems.Count
                };
            }

            // Create backups before executing mutation
            var stashBackup = SaveBackup.CreateBackup(request.SourceStashFile);
            var charBackup = SaveBackup.CreateBackup(request.TargetCharFile);

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

            // Save both files
            File.WriteAllBytes(request.SourceStashFile, stash.ToBytes(externalData, 105));
            File.WriteAllBytes(request.TargetCharFile, save.ToBytes(externalData, 105));

            int remaining = candidateItems.Count - movedItems.Count;
            return new BulkTransferResult
            {
                Success = true,
                Message = $"Successfully packed {movedItems.Count} items into {Path.GetFileNameWithoutExtension(request.TargetCharFile)}. ({remaining} items remained in stash)",
                ItemsMoved = movedItems.Count,
                ItemsRemaining = remaining,
                MovedItemCodes = movedCodes,
                SourceBackup = stashBackup,
                TargetBackup = charBackup
            };
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
        foreach (var item in items)
        {
            if (seed.HasValue && item.ItemSeed == seed.Value)
                return item;
            if (x.HasValue && y.HasValue && item.Position.InvX == x.Value && item.Position.InvY == y.Value)
            {
                if (string.IsNullOrEmpty(code) || item.ItemCodeString.Trim().Equals(code.Trim(), StringComparison.OrdinalIgnoreCase))
                    return item;
            }
        }
        return null;
    }

    public static int RunCli(string[] args, string defaultSaveDir, string excelDir)
    {
        if (args.Length < 1) return 1;
        var subCmd = args[0].ToLowerInvariant();

        if (subCmd == "transfer-item")
        {
            var req = new ItemTransferRequest { ExcelDir = excelDir };
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
                    case "--force-live": req.ForceLive = true; break;
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
        "stash" or "bank" or "personal-stash" => ContainerType.Stash,
        "cube" or "horadric" or "horadric-cube" => ContainerType.Cube,
        _ => ContainerType.Inventory
    };
}
