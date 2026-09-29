$ErrorActionPreference = "Stop"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$EnvPath = Join-Path $Root "backend\.env"

if (-not (Test-Path -LiteralPath $EnvPath)) {
  throw "backend/.env was not found. Run scripts/setup-local.ps1 first or copy backend/.env.example to backend/.env."
}

$lines = @(Get-Content -LiteralPath $EnvPath)
$keyPattern = '^C2_REGISTRY_ENCRYPTION_KEY=(.*)$'
$keyLines = @($lines | Where-Object { $_ -match $keyPattern })
$currentKey = $null
if ($keyLines.Count -gt 0) {
  $currentKey = $keyLines[0] -replace $keyPattern, '$1'
}

if ($currentKey -match '^[0-9a-fA-F]{64}$') {
  Write-Host "C2 registry encryption key is already configured; keeping it unchanged." -ForegroundColor Green
  exit 0
}

$keyBytes = New-Object byte[] 32
$random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
try {
  $random.GetBytes($keyBytes)
} finally {
  $random.Dispose()
}
$newKey = ([System.BitConverter]::ToString($keyBytes)).Replace("-", "").ToLowerInvariant()

$outputLines = @($lines | Where-Object { $_ -notmatch $keyPattern })
$outputLines += "C2_REGISTRY_ENCRYPTION_KEY=$newKey"
Set-Content -LiteralPath $EnvPath -Value $outputLines

Write-Host "Generated and saved a stable C2 registry key in backend/.env. The key was not displayed." -ForegroundColor Green
