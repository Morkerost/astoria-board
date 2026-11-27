param([switch]$DebugBuild)
$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $MyInvocation.MyCommand.Path
$desktop = Join-Path $project 'desktop'
$web = Join-Path $desktop 'web'
$target = Join-Path $desktop '.cargo-target'
$cargoBin = Join-Path $desktop '.cargo-install\bin'
$output = Join-Path $desktop 'dist'
$cargoManifest = Get-Content -LiteralPath (Join-Path $desktop 'src-tauri\Cargo.toml') -Raw
if ($cargoManifest -notmatch '(?m)^name\s*=\s*"([^"]+)"') { throw 'Не удалось определить имя Rust-пакета в Cargo.toml.' }
$binaryName = $Matches[1]
$tauriConfig = Get-Content -LiteralPath (Join-Path $desktop 'src-tauri\tauri.conf.json') -Raw | ConvertFrom-Json
$appName = [string]$tauriConfig.productName
if ([string]::IsNullOrWhiteSpace($appName)) { throw 'В tauri.conf.json не задан productName.' }

New-Item -ItemType Directory -Force -Path $web, $target, $output | Out-Null
foreach ($file in @('index.html', 'board.js', 'rpg.css', 'backup.js', 'desktop-backup.js', 'counter.js', 'rpg.js')) {
    Copy-Item -LiteralPath (Join-Path $project $file) -Destination (Join-Path $web $file) -Force
}

$env:CARGO_TARGET_DIR = $target
$env:PATH = "$cargoBin;$env:PATH"
if (-not (Test-Path -LiteralPath (Join-Path $cargoBin 'cargo-tauri.exe'))) {
    cargo install tauri-cli --version '^2' --locked --root (Join-Path $desktop '.cargo-install') --target-dir $target
    if ($LASTEXITCODE -ne 0) { throw 'Не удалось установить инструмент сборки Tauri.' }
}
Push-Location $desktop
try {
    $args = @('tauri', 'build')
    if ($DebugBuild) { $args += '--debug' }
    $args += '--no-bundle'
    cargo @args
    if ($LASTEXITCODE -ne 0) { throw 'Не удалось собрать приложение.' }
} finally {
    Pop-Location
}

$configuration = if ($DebugBuild) { 'debug' } else { 'release' }
$executable = Join-Path $output ($appName + '.exe')
Copy-Item -LiteralPath (Join-Path $target "$configuration\$binaryName.exe") -Destination $executable -Force
Write-Host ('Готово: ' + $executable)

