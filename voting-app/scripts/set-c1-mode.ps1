param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("on", "off")]
  [string]$Mode
)

$ErrorActionPreference = "Stop"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$BackendEnv = Join-Path $Root "backend\.env"
$RegistryArtifact = Join-Path $Root "smart-contracts\build\contracts\EncryptedBallotRegistry.json"
$Enabled = if ($Mode -eq "on") { "true" } else { "false" }

function Set-EnvValue($File, $Key, $Value) {
  if (-not (Test-Path $File)) {
    throw "$File does not exist. Run npm run setup:local first."
  }

  $lines = Get-Content $File
  $entry = "$Key=$Value"

  if ($lines | Where-Object { $_ -match "^$([regex]::Escape($Key))=" }) {
    $lines = $lines | ForEach-Object {
      if ($_ -match "^$([regex]::Escape($Key))=") { $entry } else { $_ }
    }
  } else {
    $lines += $entry
  }

  Set-Content -Path $File -Value $lines
}

function Get-RegistryAddress {
  if (-not (Test-Path $RegistryArtifact)) {
    return ""
  }

  Push-Location (Split-Path $RegistryArtifact -Parent)
  try {
    return node -e "const artifact=require('./EncryptedBallotRegistry.json'); const networks=artifact.networks||{}; const deployed=networks['31337']||networks[process.env.ANVIL_CHAIN_ID||'31337']; console.log(deployed?.address||'');"
  } finally {
    Pop-Location
  }
}

$registryAddress = Get-RegistryAddress

Set-EnvValue $BackendEnv "C1_CHAIN_RECEIPTS_ENABLED" $Enabled
Set-EnvValue $BackendEnv "C1_REVOTING_ENABLED" $Enabled

if ($Mode -eq "on") {
  if (-not $registryAddress) {
    throw "EncryptedBallotRegistry address was not found. Run npm run setup:local or npm run deploy:anvil first."
  }

  Set-EnvValue $BackendEnv "C1_ENCRYPTED_BALLOT_REGISTRY_ADDRESS" $registryAddress
}

Write-Host "C1 receipt anchoring is $Mode." -ForegroundColor Green
if ($Mode -eq "on") {
  Write-Host "Registry: $registryAddress" -ForegroundColor Green
}
