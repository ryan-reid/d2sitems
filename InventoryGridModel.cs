using System;
using System.Collections.Generic;
using System.IO;
using D2SSharp.Enums;
using D2SSharp.Model;

namespace D2SItems;

/// <summary>
/// Container grid dimensions loaded dynamically from mod files (inventory.txt).
/// Automatically accommodates mod-specific sizes (e.g. BKDiablo 11x8 Inv, 16x13 Stash, 6x6 Cube).
/// </summary>
public class ContainerDimensions
{
    public Dictionary<string, (int Width, int Height)> ClassInventorySizes { get; } = new(StringComparer.OrdinalIgnoreCase);
    public (int Width, int Height) StashSize { get; set; } = (16, 13);
    public (int Width, int Height) CubeSize { get; set; } = (6, 6);
    public (int Width, int Height) SharedStashSize { get; set; } = (16, 13);

    public (int Width, int Height) GetInventorySize(string? className)
    {
        if (!string.IsNullOrEmpty(className))
        {
            if (ClassInventorySizes.TryGetValue(className, out var size))
                return size;
            var clean = className.TrimEnd('2');
            if (ClassInventorySizes.TryGetValue(clean, out var cleanSize))
                return cleanSize;
        }
        return (11, 8); // Default fallback for BKDiablo
    }

    public static ContainerDimensions LoadFromExcel(string excelDir)
    {
        var dims = new ContainerDimensions();
        var invPath = Path.Combine(excelDir, "inventory.txt");
        if (!File.Exists(invPath))
            return dims;

        var lines = File.ReadAllLines(invPath);
        if (lines.Length < 2)
            return dims;

        var header = lines[0].Split('\t');
        int clsIdx = Array.IndexOf(header, "class");
        int gxIdx = Array.IndexOf(header, "gridX");
        int gyIdx = Array.IndexOf(header, "gridY");
        if (clsIdx < 0 || gxIdx < 0 || gyIdx < 0)
            return dims;

        for (int i = 1; i < lines.Length; i++)
        {
            var line = lines[i];
            if (string.IsNullOrWhiteSpace(line)) continue;
            var cols = line.Split('\t');
            if (cols.Length <= Math.Max(clsIdx, Math.Max(gxIdx, gyIdx))) continue;

            var cls = cols[clsIdx].Trim();
            if (!int.TryParse(cols[gxIdx].Trim(), out int gx) || !int.TryParse(cols[gyIdx].Trim(), out int gy))
                continue;
            if (gx <= 0 || gy <= 0)
                continue;

            if (cls.Equals("Big Bank Page 1", StringComparison.OrdinalIgnoreCase) ||
                cls.Equals("Big Bank Page2", StringComparison.OrdinalIgnoreCase) ||
                cls.Equals("Bank Page 1", StringComparison.OrdinalIgnoreCase) ||
                cls.Equals("Bank Page2", StringComparison.OrdinalIgnoreCase))
            {
                dims.StashSize = (gx, gy);
                dims.SharedStashSize = (gx, gy);
            }
            else if (cls.Equals("Transmogrify Box Page 1", StringComparison.OrdinalIgnoreCase) ||
                     cls.Equals("Transmogrify Box2", StringComparison.OrdinalIgnoreCase))
            {
                dims.CubeSize = (gx, gy);
            }
            else if (!cls.StartsWith("Trade", StringComparison.OrdinalIgnoreCase) &&
                     !cls.StartsWith("Monster", StringComparison.OrdinalIgnoreCase) &&
                     !cls.StartsWith("Hireling", StringComparison.OrdinalIgnoreCase) &&
                     !cls.Equals("Expansion", StringComparison.OrdinalIgnoreCase))
            {
                dims.ClassInventorySizes[cls] = (gx, gy);
                var clean = cls.TrimEnd('2');
                if (!dims.ClassInventorySizes.ContainsKey(clean))
                    dims.ClassInventorySizes[clean] = (gx, gy);
            }
        }

        return dims;
    }
}

/// <summary>
/// Lookup for item footprint dimensions (invwidth x invheight) loaded from armor.txt, weapons.txt, and misc.txt.
/// </summary>
public class ItemDimensionsLookup
{
    private readonly Dictionary<string, (int Width, int Height)> _sizes = new(StringComparer.OrdinalIgnoreCase);

    public (int Width, int Height) GetSize(string? itemCode)
    {
        if (string.IsNullOrEmpty(itemCode))
            return (1, 1);
        var trimmed = itemCode.TrimEnd('\0').Trim();
        if (_sizes.TryGetValue(trimmed, out var sz))
            return sz;
        return (1, 1);
    }

    public static ItemDimensionsLookup LoadFromExcel(string excelDir)
    {
        var lookup = new ItemDimensionsLookup();
        foreach (var file in new[] { "armor.txt", "weapons.txt", "misc.txt" })
        {
            var path = Path.Combine(excelDir, file);
            if (!File.Exists(path)) continue;

            var lines = File.ReadAllLines(path);
            if (lines.Length < 2) continue;

            var header = lines[0].Split('\t');
            int codeIdx = Array.IndexOf(header, "code");
            int wIdx = Array.IndexOf(header, "invwidth");
            int hIdx = Array.IndexOf(header, "invheight");
            if (codeIdx < 0 || wIdx < 0 || hIdx < 0) continue;

            for (int i = 1; i < lines.Length; i++)
            {
                var line = lines[i];
                if (string.IsNullOrWhiteSpace(line)) continue;
                var cols = line.Split('\t');
                if (cols.Length <= Math.Max(codeIdx, Math.Max(wIdx, hIdx))) continue;

                var code = cols[codeIdx].Trim();
                if (string.IsNullOrEmpty(code)) continue;

                int w = int.TryParse(cols[wIdx].Trim(), out int parsedW) ? parsedW : 1;
                int h = int.TryParse(cols[hIdx].Trim(), out int parsedH) ? parsedH : 1;
                lookup._sizes[code] = (Math.Max(1, w), Math.Max(1, h));
            }
        }
        return lookup;
    }
}

/// <summary>
/// 2D collision detection and placement grid for Diablo II inventory containers.
/// </summary>
public class ContainerGrid2D
{
    public int Width { get; }
    public int Height { get; }
    private readonly bool[,] _occupied;

    public ContainerGrid2D(int width, int height)
    {
        Width = Math.Max(1, width);
        Height = Math.Max(1, height);
        _occupied = new bool[Width, Height];
    }

    public bool IsOccupied(int x, int y)
    {
        if (x < 0 || x >= Width || y < 0 || y >= Height)
            return true;
        return _occupied[x, y];
    }

    public void MarkOccupied(int x, int y, int w, int h)
    {
        for (int dx = 0; dx < w; dx++)
        {
            for (int dy = 0; dy < h; dy++)
            {
                int px = x + dx;
                int py = y + dy;
                if (px >= 0 && px < Width && py >= 0 && py < Height)
                {
                    _occupied[px, py] = true;
                }
            }
        }
    }

    public bool CanPlace(int x, int y, int w, int h)
    {
        if (x < 0 || y < 0 || x + w > Width || y + h > Height)
            return false;

        for (int dx = 0; dx < w; dx++)
        {
            for (int dy = 0; dy < h; dy++)
            {
                if (_occupied[x + dx, y + dy])
                    return false;
            }
        }
        return true;
    }

    public (int X, int Y)? FindFirstAvailableSlot(int w, int h)
    {
        for (int y = 0; y <= Height - h; y++)
        {
            for (int x = 0; x <= Width - w; x++)
            {
                if (CanPlace(x, y, w, h))
                    return (x, y);
            }
        }
        return null;
    }

    /// <summary>
    /// Builds a 2D occupancy grid for a specific container in a character save.
    /// </summary>
    public static ContainerGrid2D BuildCharacterGrid(
        D2Save save,
        StorePage page,
        ContainerDimensions dims,
        ItemDimensionsLookup itemDims,
        Item? excludeItem = null)
    {
        var (w, h) = page switch
        {
            StorePage.Inventory => dims.GetInventorySize(save.Character.Class.ToString()),
            StorePage.Stash => dims.StashSize,
            StorePage.Cube => dims.CubeSize,
            _ => (10, 4)
        };

        var grid = new ContainerGrid2D(w, h);
        foreach (var item in save.Items)
        {
            if (ReferenceEquals(item, excludeItem))
                continue;
            if (item.Position.Mode == ItemMode.Stored && item.Position.StorePage == page)
            {
                var (iw, ih) = itemDims.GetSize(item.ItemCodeString);
                grid.MarkOccupied(item.Position.InvX, item.Position.InvY, iw, ih);
            }
        }
        return grid;
    }

    /// <summary>
    /// Builds a 2D occupancy grid for a specific shared stash tab.
    /// </summary>
    public static ContainerGrid2D BuildSharedStashGrid(
        D2StashTab tab,
        ContainerDimensions dims,
        ItemDimensionsLookup itemDims,
        Item? excludeItem = null)
    {
        var (w, h) = dims.SharedStashSize;
        var grid = new ContainerGrid2D(w, h);
        foreach (var item in tab.Items)
        {
            if (ReferenceEquals(item, excludeItem))
                continue;
            if (item.Position.Mode == ItemMode.Stored)
            {
                var (iw, ih) = itemDims.GetSize(item.ItemCodeString);
                grid.MarkOccupied(item.Position.InvX, item.Position.InvY, iw, ih);
            }
        }
        return grid;
    }
}
