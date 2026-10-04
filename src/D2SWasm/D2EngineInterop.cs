using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Runtime.InteropServices.JavaScript;
using System.Runtime.Versioning;
using System.Text.Json;
using Microsoft.JSInterop;
using D2SSharp.Data;
using D2SSharp.Enums;
using D2SSharp.Model;
using D2SItems;

namespace D2SWasm;

[SupportedOSPlatform("browser")]
public partial class D2EngineInterop
{
    public static readonly string DataDir = Path.Combine(AppContext.BaseDirectory, "data");
    public static readonly string ExcelDir = Path.Combine(DataDir, "excel");
    public static readonly string StringsDir = Path.Combine(DataDir, "strings");
    public static readonly string BaselinesDir = Path.Combine(DataDir, "baselines");

    private static SaveInspectorEngine? _engine;
    private static bool _initialized = false;
    [JSExport]
    public static string PackWorkspace(string filesJson, string planJson)
    {
        try
        {
            var files = JsonSerializer.Deserialize<Dictionary<string, byte[]>>(filesJson)!;
            var plan = JsonSerializer.Deserialize<MulePackingPlan>(planJson, new JsonSerializerOptions { PropertyNameCaseInsensitive = true })!;
            var result = MulePackingPlanner.Plan(files, plan, ExcelDir, BaselinesDir);
            return JsonSerializer.Serialize(new { success = true, files = result.Files, moved = result.Moved, remaining = result.Remaining, created = result.Created });
        }
        catch (Exception e) { return JsonSerializer.Serialize(new { success = false, error = e.Message }); }
    }
    private static readonly object _initLock = new();

    public static void ExtractEmbeddedData()
    {
        var asm = typeof(D2EngineInterop).Assembly;
        var names = asm.GetManifestResourceNames();

        foreach (var rawName in names)
        {
            var relative = rawName.Replace('\\', '/').TrimStart('/');
            var targetPath = Path.Combine(DataDir, relative);
            var parent = Path.GetDirectoryName(targetPath);
            if (!string.IsNullOrEmpty(parent))
                Directory.CreateDirectory(parent);

            using var inStream = asm.GetManifestResourceStream(rawName);
            if (inStream != null)
            {
                using var outStream = File.Create(targetPath);
                inStream.CopyTo(outStream);
            }
        }
    }

    [JSExport]
    [JSInvokable]
    public static string InitEngine(string? overrideCatalogRevision = null)
    {
        lock (_initLock)
        {
            if (!_initialized)
            {
                ExtractEmbeddedData();
                _engine = new SaveInspectorEngine(ExcelDir, StringsDir, excludedItems: null, overrideCatalogRevision: overrideCatalogRevision);
                _initialized = true;
            }
        }

        return JsonSerializer.Serialize(new
        {
            ready = true,
            catalog = _engine!.CollectionCatalog(),
            version = "1.0.0",
            excelDir = ExcelDir,
            message = "D2SWasm Engine initialized successfully."
        });
    }

    private static void EnsureInitialized() { if (!_initialized) { InitEngine(null); } }

    [JSExport]
    [JSInvokable]
    public static string ParseCharacterSave(string fileName, byte[] d2sBytes)
    {
        EnsureInitialized();
        if (_engine == null)
            throw new InvalidOperationException("Engine not initialized.");

        return _engine.ProcessCharacterSaveToJson(fileName, d2sBytes);
    }

    [JSExport]
    [JSInvokable]
    public static string ParseSharedStash(string fileName, byte[] d2iBytes)
    {
        EnsureInitialized();
        if (_engine == null)
            throw new InvalidOperationException("Engine not initialized.");

        return _engine.ProcessSharedStashToJson(fileName, d2iBytes);
    }

    [JSExport]
    [JSInvokable]
    public static string CreateMule(string name, string charClass, bool hardcore)
    {
        EnsureInitialized();
        var (d2sBytes, ctlBytes, error) = MuleGenerator.CreateMuleBytes(name, charClass, hardcore, ExcelDir, BaselinesDir);

        if (error != null || d2sBytes == null)
        {
            return JsonSerializer.Serialize(new
            {
                success = false,
                error = error ?? "Failed to create mule."
            });
        }

        return JsonSerializer.Serialize(new
        {
            success = true,
            name = name,
            d2sBase64 = Convert.ToBase64String(d2sBytes),
            ctlBase64 = ctlBytes != null ? Convert.ToBase64String(ctlBytes) : null,
            message = $"Successfully generated {charClass} mule '{name}'."
        });
    }

    [JSExport]
    [JSInvokable]
    public static string CompleteQuests(byte[] d2sBytes, string difficulty, int act, bool waypoints, bool rewards)
    {
        EnsureInitialized();
        int? actParam = act >= 1 && act <= 5 ? act : null;
        var (success, outBytes, message) = QuestManager.CompleteQuestsBytes(
            d2sBytes,
            difficulty,
            actParam,
            waypoints,
            rewards,
            ExcelDir);

        return JsonSerializer.Serialize(new
        {
            success = success,
            d2sBase64 = outBytes != null ? Convert.ToBase64String(outBytes) : null,
            message = message
        });
    }

    [JSExport]
    [JSInvokable]
    public static string TransferItem(string requestJson, byte[] sourceBytes, byte[]? targetBytes)
    {
        EnsureInitialized();
        try
        {
            var req = JsonSerializer.Deserialize<ItemTransferRequest>(requestJson, new JsonSerializerOptions
            {
                PropertyNameCaseInsensitive = true,
                Converters = { new System.Text.Json.Serialization.JsonStringEnumConverter() }
            });

            if (req == null)
            {
                return JsonSerializer.Serialize(new { success = false, message = "Invalid transfer request JSON." });
            }

            req.ExcelDir = ExcelDir;

            byte[]? effectiveTarget = (targetBytes != null && targetBytes.Length > 0) ? targetBytes : null;
            var (newSrc, newDst, result) = ItemTransferManager.TransferItemBytes(sourceBytes, effectiveTarget, req, ExcelDir);

            return JsonSerializer.Serialize(new
            {
                success = result.Success,
                message = result.Message,
                isProtected = result.IsProtected,
                sourceBytesBase64 = newSrc != null ? Convert.ToBase64String(newSrc) : null,
                targetBytesBase64 = newDst != null ? Convert.ToBase64String(newDst) : null
            });
        }
        catch (Exception ex)
        {
            return JsonSerializer.Serialize(new
            {
                success = false,
                message = $"Transfer exception: {ex.Message}"
            });
        }
    }

    [JSExport]
    [JSInvokable]
    public static string BulkTransfer(string requestJson, byte[] sourceBytes, byte[]? targetBytes)
    {
        EnsureInitialized();
        try
        {
            if (targetBytes == null || targetBytes.Length == 0)
            {
                return JsonSerializer.Serialize(new { success = false, message = "Target character bytes required for bulk transfer." });
            }

            var req = JsonSerializer.Deserialize<BulkTransferRequest>(requestJson, new JsonSerializerOptions
            {
                PropertyNameCaseInsensitive = true,
                Converters = { new System.Text.Json.Serialization.JsonStringEnumConverter() }
            });

            if (req == null)
            {
                return JsonSerializer.Serialize(new { success = false, message = "Invalid bulk transfer request JSON." });
            }

            req.ExcelDir = ExcelDir;

            var (newSrc, newDst, result) = ItemTransferManager.BulkTransferBytes(sourceBytes, targetBytes, req, ExcelDir);

            return JsonSerializer.Serialize(new
            {
                success = result.Success,
                message = result.Message,
                isProtected = result.IsProtected,
                itemsMoved = result.ItemsMoved,
                itemsRemaining = result.ItemsRemaining,
                movedItemCodes = result.MovedItemCodes,
                sourceBytesBase64 = newSrc != null ? Convert.ToBase64String(newSrc) : null,
                targetBytesBase64 = newDst != null ? Convert.ToBase64String(newDst) : null
            });
        }
        catch (Exception ex)
        {
            return JsonSerializer.Serialize(new
            {
                success = false,
                message = $"Bulk transfer exception: {ex.Message}"
            });
        }
    }

    [JSExport]
    [JSInvokable]
    public static string EditStack(byte[] stashBytes, int tabIndex, string itemCode, int quantity, string itemSeed)
    {
        EnsureInitialized();
        try
        {
            var req = new EditStackRequest
            {
                ItemSeed = uint.Parse(itemSeed),
                TabIndex = tabIndex,
                ItemCode = itemCode,
                Quantity = quantity,
                ExcelDir = ExcelDir
            };

            var (newBytes, result) = StackEditorManager.EditStackBytes(stashBytes, req, ExcelDir);
            return JsonSerializer.Serialize(new
            {
                success = result.Success,
                message = result.Message,
                code = result.ItemCode,
                quantity = result.NewQuantity,
                stashBytesBase64 = newBytes != null ? Convert.ToBase64String(newBytes) : null
            });
        }
        catch (Exception ex)
        {
            return JsonSerializer.Serialize(new
            {
                success = false,
                message = $"Edit stack exception: {ex.Message}"
            });
        }
    }
    [JSExport]
    [JSInvokable]
    public static string CreateItem(string requestJson, byte[] saveBytes, bool isStash, int tabIndex)
    {
        EnsureInitialized();
        try
        {
            var req = JsonSerializer.Deserialize<NetNewItemRequest>(requestJson, new JsonSerializerOptions
            {
                PropertyNameCaseInsensitive = true,
                Converters = { new System.Text.Json.Serialization.JsonStringEnumConverter() }
            });
            if (req == null)
            {
                return JsonSerializer.Serialize(new { success = false, error = "Invalid item request JSON." });
            }

            var (newBytes, error) = isStash
                ? NetNewItemManager.CreateStashItem(saveBytes, tabIndex, req, ExcelDir)
                : NetNewItemManager.CreateCharacterItem(saveBytes, req, ExcelDir);

            if (newBytes == null)
            {
                return JsonSerializer.Serialize(new { success = false, error });
            }

            return JsonSerializer.Serialize(new
            {
                success = true,
                bytesBase64 = Convert.ToBase64String(newBytes)
            });
        }
        catch (Exception ex)
        {
            return JsonSerializer.Serialize(new { success = false, error = ex.Message });
        }
    }
}
