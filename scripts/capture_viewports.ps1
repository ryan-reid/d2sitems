# scripts/capture_viewports.ps1
# Automated headless Edge screenshot capture across Desktop, Tablet, and Mobile viewports.
[CmdletBinding()]
param(
    [string]$Url = "http://127.0.0.1:5000/",
    [string]$OutputDir = "C:\Users\Ryan\.gemini\antigravity-cli\brain\017c3277-fe38-4ec7-b8c9-64a5b7a863b6\scratch",
    [string]$Prefix = "viewport"
)

$ErrorActionPreference = 'Stop'
$edgePath = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
if (-not (Test-Path $edgePath)) {
    throw "Microsoft Edge not found at $edgePath"
}

if (-not (Test-Path $OutputDir)) {
    New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
}

$viewports = @(
    @{ Name = "desktop"; Width = 1400; Height = 900 },
    @{ Name = "tablet";  Width = 900;  Height = 800 },
    @{ Name = "mobile";  Width = 390;  Height = 844 }
)

Write-Host "Capturing viewports for: $Url" -ForegroundColor Cyan
Write-Host "Output Directory: $OutputDir`n"

foreach ($vp in $viewports) {
    $outFile = Join-Path $OutputDir "$($Prefix)_$($vp.Name).png"
    Write-Host "Capturing $($vp.Name) ($($vp.Width)x$($vp.Height)) -> $outFile..." -NoNewline
    
    $args = @(
        "--headless",
        "--disable-gpu",
        "--window-size=$($vp.Width),$($vp.Height)",
        "--virtual-time-budget=8000",
        "--screenshot=$outFile",
        $Url
    )

    $p = Start-Process -FilePath $edgePath -ArgumentList $args -NoNewWindow -Wait -PassThru
    
    if (Test-Path $outFile) {
        $size = (Get-Item $outFile).Length
        Write-Host " OK ($([Math]::Round($size / 1024, 1)) KB)" -ForegroundColor Green
    } else {
        Write-Host " FAILED" -ForegroundColor Red
    }
}

Write-Host "`nCapture complete." -ForegroundColor Green
