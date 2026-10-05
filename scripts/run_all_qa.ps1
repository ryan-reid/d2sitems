# scripts/run_all_qa.ps1
# Unified runner for the 4-tier d2sitems test matrix.
[CmdletBinding()]
param(
    [switch]$SkipBrowser = $false,
    [int]$BrowserPort = 8765
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

Write-Host "================================================================" -ForegroundColor Cyan
Write-Host " d2sitems Complete 4-Tier Test Matrix Runner" -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "Working Directory: $repoRoot`n"

$results = [System.Collections.Generic.List[PSCustomObject]]::new()
$overallSuccess = $true

function Run-Tier {
    param(
        [string]$Name,
        [scriptblock]$Action
    )
    Write-Host "[RUNNING] $Name..." -NoNewline
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $status = "PASS"
    $errMessage = ""
    try {
        & $Action
    }
    catch {
        $status = "FAIL"
        $errMessage = $_.Exception.Message
        $script:overallSuccess = $false
    }
    $sw.Stop()
    $duration = "{0:N2}s" -f $sw.Elapsed.TotalSeconds

    if ($status -eq "PASS") {
        Write-Host " [PASS] ($duration)" -ForegroundColor Green
    } else {
        Write-Host " [FAIL] ($duration)" -ForegroundColor Red
        if ($errMessage) {
            Write-Host "         $errMessage" -ForegroundColor DarkRed
        }
    }

    $script:results.Add([PSCustomObject]@{
        Tier = $Name
        Status = $status
        Duration = $duration
    })
}

# Tier 1: C# Save Safety & Transaction Recovery
Run-Tier -Name "Tier 1: Save Safety & Crash Recovery" -Action {
    $p = Start-Process -FilePath "dotnet" -ArgumentList "run --project tests/save_safety/SaveSafety.csproj" -NoNewWindow -Wait -PassThru
    if ($p.ExitCode -ne 0) {
        throw "SaveSafety failed with exit code $($p.ExitCode)"
    }
}

# Tier 2: C# Engine Regressions & Byte Conservation
Run-Tier -Name "Tier 2: Engine Regressions & Parity" -Action {
    $p = Start-Process -FilePath "dotnet" -ArgumentList "run --project tests/engine_regressions/EngineRegressions.csproj" -NoNewWindow -Wait -PassThru
    if ($p.ExitCode -ne 0) {
        throw "EngineRegressions failed with exit code $($p.ExitCode)"
    }
}

# Tier 3: Python API & Mod Catalog Unit Tests
Run-Tier -Name "Tier 3: Python API & Catalog Tests" -Action {
    $p = Start-Process -FilePath "python" -ArgumentList "-m unittest tests/test_catalog.py tests/test_api.py tests/test_edit_workspace.py tests/test_server.py tests/test_release_monitor.py" -NoNewWindow -Wait -PassThru
    if ($p.ExitCode -ne 0) {
        throw "Python catalog/API tests failed with exit code $($p.ExitCode)"
    }
}

# Tier 4: Headless Browser WASM Automation
if (-not $SkipBrowser) {
    Run-Tier -Name "Tier 4: Headless Browser WASM Suite" -Action {
        $serverStartedHere = $false
        $serverProc = $null
        $testUrl = "http://127.0.0.1:$BrowserPort/tests/browser_regressions.html"
        
        try {
            $resp = Invoke-WebRequest -Uri "http://127.0.0.1:$BrowserPort/" -TimeoutSec 1 -UseBasicParsing -ErrorAction SilentlyContinue
        } catch {
            $resp = $null
        }

        if (-not $resp) {
            $serverProc = Start-Process -FilePath "python" -ArgumentList "-m http.server $BrowserPort" -WorkingDirectory $repoRoot -PassThru -WindowStyle Hidden
            $serverStartedHere = $true
            Start-Sleep -Milliseconds 1500
        }

        try {
            $p = Start-Process -FilePath "node" -ArgumentList "tests/run_browser_regressions.mjs $testUrl" -NoNewWindow -Wait -PassThru
            if ($p.ExitCode -ne 0) {
                throw "Browser regressions failed with exit code $($p.ExitCode)"
            }
        }
        finally {
            if ($serverStartedHere -and $serverProc) {
                Stop-Process -Id $serverProc.Id -Force -ErrorAction SilentlyContinue
            }
        }
    }
} else {
    $results.Add([PSCustomObject]@{
        Tier = "Tier 4: Headless Browser WASM Suite"
        Status = "SKIPPED"
        Duration = "0.00s"
    })
}

Write-Host "`n----------------------------------------------------------------" -ForegroundColor Gray
Write-Host " Test Matrix Summary" -ForegroundColor Cyan
Write-Host "----------------------------------------------------------------" -ForegroundColor Gray
$results | Format-Table -AutoSize

if ($overallSuccess) {
    Write-Host "All tiers passed successfully.`n" -ForegroundColor Green
    exit 0
} else {
    Write-Host "One or more tiers failed. Check logs above.`n" -ForegroundColor Red
    exit 1
}
