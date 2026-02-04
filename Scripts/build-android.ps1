# scripts/build-android.ps1
param(
    [ValidateSet("arm64", "x86_64", "all")]
    [string]$Arch = "all",

    [switch]$Release = $false
)

$ErrorActionPreference = "Stop"
$androidDir = "$PSScriptRoot\..\src-tauri\gen\android"

function Build-Apk {
    param([string]$targetArch, [string]$gradleTask)

    Write-Host "Building Android $targetArch..." -ForegroundColor Cyan

    Push-Location $androidDir
    try {
        if ($Release) {
            .\gradlew.bat :app:assemble$gradleTask
        } else {
            .\gradlew.bat :app:assemble$($gradleTask)Debug
        }

        if ($LASTEXITCODE -ne 0) {
            Write-Error "Android $targetArch build failed!"
            exit 1
        }
    }
    finally {
        Pop-Location
    }

    Write-Host "Android $targetArch build complete!" -ForegroundColor Green
}

# Build requested architectures
if ($Arch -eq "all" -or $Arch -eq "arm64") {
    $task = if ($Release) { "Arm64Release" } else { "Arm64Debug" }
    Build-Apk -targetArch "arm64" -gradleTask $task
}

if ($Arch -eq "all" -or $Arch -eq "x86_64") {
    $task = if ($Release) { "X86_64Release" } else { "X86_64Debug" }
    Build-Apk -targetArch "x86_64" -gradleTask $task
}

Write-Host "All Android builds complete!" -ForegroundColor Green
Write-Host "Output: $androidDir\app\build\outputs\apk\" -ForegroundColor Green
