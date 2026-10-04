using System;

namespace D2SWasm;

public class Program
{
    public static void Main(string[] args)
    {
        Console.WriteLine("[D2SWasm] WebAssembly runtime started.");
        try
        {
            D2EngineInterop.ExtractEmbeddedData();
            Console.WriteLine("[D2SWasm] Embedded data extracted successfully.");
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[D2SWasm] Warning during embedded data extraction: {ex.Message}");
        }
    }
}
