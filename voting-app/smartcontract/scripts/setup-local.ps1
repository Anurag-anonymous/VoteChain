param(
  [switch]$SkipInstall,
  [switch]$SkipServices,
  [switch]$SkipDeploy,
  [switch]$NoAutoInstall
)

$ErrorActionPreference = "Stop"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$BackendDir = Join-Path $Root "backend"
$FrontendDir = Join-Path $Root "frontend"
$ContractsDir = Join-Path $Root "smart-contracts"
$LocalDir = Join-Path $Root ".local"
$MongoDataDir = Join-Path $LocalDir "mongodb-data"

$AnvilPrivateKey = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"

function Write-Step($Message) {
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Refresh-Path {
  $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  $env:Path = "$machinePath;$userPath"
}

function Add-PathIfExists($PathToAdd) {
  if ((Test-Path $PathToAdd) -and ($env:Path -notlike "*$PathToAdd*")) {
    $env:Path = "$PathToAdd;$env:Path"
  }
}

function Invoke-WingetInstall($PackageId, $DisplayName) {
  if ($NoAutoInstall) {
    return $false
  }

  if (-not (Get-Command "winget" -ErrorAction SilentlyContinue)) {
    Write-Host "winget is not available, so $DisplayName cannot be installed automatically." -ForegroundColor Yellow
    return $false
  }

  Write-Host "$DisplayName is missing. Attempting install with winget..." -ForegroundColor Yellow
  & winget install --id $PackageId --exact --accept-package-agreements --accept-source-agreements
  if ($LASTEXITCODE -ne 0) {
    Write-Host "winget could not install $DisplayName automatically." -ForegroundColor Yellow
    return $false
  }

  Refresh-Path
  return $true
}

function Find-Mongod {
  $command = Get-Command "mongod" -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }

  $mongoRoot = "C:\Program Files\MongoDB\Server"
  if (Test-Path $mongoRoot) {
    $match = Get-ChildItem $mongoRoot -Recurse -Filter "mongod.exe" -ErrorAction SilentlyContinue |
      Sort-Object FullName -Descending |
      Select-Object -First 1

    if ($match) {
      Add-PathIfExists $match.DirectoryName
      return $match.FullName
    }
  }

  return $null
}

function Ensure-Node {
  if ((Get-Command "node" -ErrorAction SilentlyContinue) -and (Get-Command "npm" -ErrorAction SilentlyContinue)) {
    return
  }

  Invoke-WingetInstall "OpenJS.NodeJS.LTS" "Node.js LTS" | Out-Null

  if (-not (Get-Command "node" -ErrorAction SilentlyContinue) -or -not (Get-Command "npm" -ErrorAction SilentlyContinue)) {
    throw "Node.js/npm was not found. Install Node.js LTS from https://nodejs.org/, open a new terminal, then rerun setup."
  }
}

function Ensure-Mongo {
  $mongod = Find-Mongod
  if ($mongod) {
    return $mongod
  }

  Invoke-WingetInstall "MongoDB.Server" "MongoDB Community Server" | Out-Null
  $mongod = Find-Mongod

  if (-not $mongod) {
    throw "mongod was not found. Install MongoDB Community Server from https://www.mongodb.com/try/download/community, ensure mongod is on PATH, then rerun setup."
  }

  return $mongod
}

function Ensure-Anvil {
  Add-PathIfExists (Join-Path $HOME ".foundry\bin")

  if (Get-Command "anvil" -ErrorAction SilentlyContinue) {
    return
  }

  if (-not $NoAutoInstall) {
    Write-Host "Anvil is missing. Attempting Foundry install..." -ForegroundColor Yellow
    try {
      Invoke-RestMethod "https://foundry.paradigm.xyz" | Invoke-Expression
      Add-PathIfExists (Join-Path $HOME ".foundry\bin")

      if (Get-Command "foundryup" -ErrorAction SilentlyContinue) {
        & foundryup
        Add-PathIfExists (Join-Path $HOME ".foundry\bin")
      }
    } catch {
      Write-Host "Foundry could not be installed automatically: $($_.Exception.Message)" -ForegroundColor Yellow
    }
  }

  if (-not (Get-Command "anvil" -ErrorAction SilentlyContinue)) {
    throw "anvil was not found. Install Foundry from https://book.getfoundry.sh/getting-started/installation, run foundryup, open a new terminal, then rerun setup."
  }
}

function Test-TcpPort($HostName, $Port) {
  try {
    $client = New-Object Net.Sockets.TcpClient
    $connect = $client.BeginConnect($HostName, $Port, $null, $null)
    $connected = $connect.AsyncWaitHandle.WaitOne(1000, $false)
    if ($connected) { $client.EndConnect($connect) }
    $client.Close()
    return $connected
  } catch {
    return $false
  }
}

function Wait-ForPort($HostName, $Port, $Name) {
  for ($i = 0; $i -lt 30; $i++) {
    if (Test-TcpPort $HostName $Port) {
      Write-Host "$Name is ready on $HostName`:$Port" -ForegroundColor Green
      return
    }
    Start-Sleep -Seconds 1
  }
  throw "$Name did not start on $HostName`:$Port"
}

function Test-AnvilRpc {
  try {
    $chainBody = @{
      jsonrpc = "2.0"
      method = "eth_chainId"
      params = @()
      id = 1
    } | ConvertTo-Json -Compress
    $chainResponse = Invoke-RestMethod `
      -Uri "http://127.0.0.1:8545" `
      -Method Post `
      -ContentType "application/json" `
      -Body $chainBody `
      -TimeoutSec 2
    if ($chainResponse.result -ne "0x7a69") {
      return $false
    }

    $nodeInfoBody = @{
      jsonrpc = "2.0"
      method = "anvil_nodeInfo"
      params = @()
      id = 2
    } | ConvertTo-Json -Compress
    $nodeInfoResponse = Invoke-RestMethod `
      -Uri "http://127.0.0.1:8545" `
      -Method Post `
      -ContentType "application/json" `
      -Body $nodeInfoBody `
      -TimeoutSec 2
    return ($null -ne $nodeInfoResponse.result) -and (-not $nodeInfoResponse.error)
  } catch {
    return $false
  }
}

function Wait-ForAnvil($Process) {
  for ($i = 0; $i -lt 30; $i++) {
    if (Test-AnvilRpc) {
      Write-Host "Anvil JSON-RPC is ready on 127.0.0.1:8545 (chain 31337)" -ForegroundColor Green
      return
    }
    if ($Process -and $Process.HasExited) {
      throw "Anvil exited during startup with code $($Process.ExitCode). Check whether port 8545 is available and rerun setup."
    }
    Start-Sleep -Seconds 1
  }
  throw "Foundry Anvil did not provide its JSON-RPC methods on 127.0.0.1:8545 for chain 31337. Check the Anvil process and port 8545."
}

function Ensure-EnvFile($ExamplePath, $TargetPath) {
  if (-not (Test-Path $TargetPath)) {
    Copy-Item $ExamplePath $TargetPath
    Write-Host "Created $TargetPath"
  } else {
    Write-Host "Keeping existing $TargetPath"
  }
}

function Set-EnvValue($Path, $Key, $Value) {
  $line = "$Key=$Value"
  if (-not (Test-Path $Path)) {
    Set-Content -Path $Path -Value $line
    return
  }

  $content = Get-Content $Path
  $pattern = "^$([regex]::Escape($Key))="
  if ($content | Select-String -Pattern $pattern -Quiet) {
    $content = $content | ForEach-Object {
      if ($_ -match $pattern) { $line } else { $_ }
    }
    Set-Content -Path $Path -Value $content
  } else {
    Add-Content -Path $Path -Value $line
  }
}

function Invoke-Npm($Directory, $Arguments) {
  Push-Location $Directory
  try {
    & npm @Arguments
    if ($LASTEXITCODE -ne 0) {
      throw "npm $($Arguments -join ' ') failed in $Directory"
    }
  } finally {
    Pop-Location
  }
}

Write-Step "Checking required tools"
Ensure-Node
$MongodPath = Ensure-Mongo
Ensure-Anvil

Write-Host "Node: $(node --version)"
Write-Host "npm:  $(npm --version)"
Write-Host "MongoDB: $MongodPath"
Write-Host "Anvil: $((Get-Command anvil).Source)"

Write-Step "Creating environment files"
Ensure-EnvFile (Join-Path $BackendDir ".env.example") (Join-Path $BackendDir ".env")
Ensure-EnvFile (Join-Path $FrontendDir ".env.example") (Join-Path $FrontendDir ".env.local")
& (Join-Path $PSScriptRoot "ensure-c2-registry-key.ps1")

Set-EnvValue (Join-Path $BackendDir ".env") "BLOCKCHAIN_NETWORK" "anvil"
Set-EnvValue (Join-Path $BackendDir ".env") "BLOCKCHAIN_ENABLED" "true"
Set-EnvValue (Join-Path $BackendDir ".env") "DATABASE_ENABLED" "true"
Set-EnvValue (Join-Path $BackendDir ".env") "ANVIL_RPC_URL" "http://127.0.0.1:8545"
Set-EnvValue (Join-Path $BackendDir ".env") "ANVIL_CHAIN_ID" "31337"
Set-EnvValue (Join-Path $BackendDir ".env") "PRIVATE_KEY" $AnvilPrivateKey
Set-EnvValue (Join-Path $BackendDir ".env") "MONGODB_MODE" "local"
Set-EnvValue (Join-Path $BackendDir ".env") "MONGODB_LOCAL_URI" "mongodb://127.0.0.1:27017/voting-app"
Set-EnvValue (Join-Path $BackendDir ".env") "CORS_ORIGIN" "http://localhost:3000"

Set-EnvValue (Join-Path $FrontendDir ".env.local") "REACT_APP_API_URL" "http://localhost:5000/api"
Set-EnvValue (Join-Path $FrontendDir ".env.local") "REACT_APP_POLYGON_RPC" "http://127.0.0.1:8545"
Set-EnvValue (Join-Path $FrontendDir ".env.local") "REACT_APP_CHAIN_ID" "31337"
Set-EnvValue (Join-Path $FrontendDir ".env.local") "REACT_APP_NETWORK_NAME" "Local Anvil"

Set-EnvValue (Join-Path $ContractsDir ".env") "PRIVATE_KEY" $AnvilPrivateKey

if (-not $SkipInstall) {
  Write-Step "Installing dependencies"
  Invoke-Npm $Root @("install")
  Invoke-Npm $BackendDir @("install")
  Invoke-Npm $FrontendDir @("install")
  Invoke-Npm $ContractsDir @("install")
}

if (-not $SkipServices) {
  Write-Step "Starting local MongoDB if needed"
  New-Item -ItemType Directory -Force $MongoDataDir | Out-Null
  if (-not (Test-TcpPort "127.0.0.1" 27017)) {
    Start-Process -FilePath $MongodPath -ArgumentList @("--dbpath", "`"$MongoDataDir`"", "--bind_ip", "127.0.0.1", "--port", "27017") -WindowStyle Hidden
  }
  Wait-ForPort "127.0.0.1" 27017 "MongoDB"

  Write-Step "Starting Anvil if needed"
  $anvilProcess = $null
  if (-not (Test-AnvilRpc)) {
    if (Test-TcpPort "127.0.0.1" 8545) {
      throw "Port 8545 is open but is not serving Foundry Anvil JSON-RPC on chain 31337. It may be Ganache or another EVM node; stop that service, start Foundry Anvil, and rerun setup."
    }
    $anvilCommand = Get-Command "anvil" -ErrorAction Stop
    $anvilProcess = Start-Process `
      -FilePath $anvilCommand.Source `
      -ArgumentList @("--host", "127.0.0.1", "--port", "8545", "--chain-id", "31337") `
      -WindowStyle Hidden `
      -PassThru
  }
  Wait-ForAnvil $anvilProcess
}

if (-not $SkipDeploy) {
  Write-Step "Compiling and deploying smart contract to Anvil"
  if (-not (Test-AnvilRpc)) {
    throw "Anvil JSON-RPC became unavailable before deployment. Check the Anvil process and rerun setup."
  }
  Push-Location $ContractsDir
  $previousNodeEnv = $env:NODE_ENV
  $env:NODE_ENV = "development"
  try {
    $env:PRIVATE_KEY = $AnvilPrivateKey
    & npx truffle migrate --network anvil --reset
    if ($LASTEXITCODE -ne 0) {
      if (-not (Test-AnvilRpc)) {
        throw "Truffle migration failed because Anvil JSON-RPC became unavailable. Check whether Anvil exited or port 8545 changed; do not rerun migrations against a different chain."
      }
      throw "Truffle migration failed"
    }

    $contractAddress = node -e "const artifact=require('./build/contracts/VotingPoll.json'); const networks=artifact.networks||{}; const deployed=networks['31337']||networks[process.env.ANVIL_CHAIN_ID||'31337']; if(!deployed?.address){process.exit(1)}; console.log(deployed.address);"
    if (-not $contractAddress) {
      throw "Could not read deployed VotingPoll address for Anvil network 31337"
    }

    $registryAddress = node -e "const artifact=require('./build/contracts/EncryptedBallotRegistry.json'); const networks=artifact.networks||{}; const deployed=networks['31337']||networks[process.env.ANVIL_CHAIN_ID||'31337']; if(!deployed?.address){process.exit(1)}; console.log(deployed.address);"
    if (-not $registryAddress) {
      throw "Could not read deployed EncryptedBallotRegistry address for Anvil network 31337"
    }
  } finally {
    if ($null -eq $previousNodeEnv) {
      Remove-Item Env:NODE_ENV -ErrorAction SilentlyContinue
    } else {
      $env:NODE_ENV = $previousNodeEnv
    }
    Pop-Location
  }

  $codeBody = @{
    jsonrpc = "2.0"
    method = "eth_getCode"
    params = @($contractAddress, "latest")
    id = 1
  } | ConvertTo-Json -Compress
  $contractCode = (Invoke-RestMethod -Uri "http://127.0.0.1:8545" -Method Post -ContentType "application/json" -Body $codeBody).result
  if (-not $contractCode -or $contractCode -eq "0x") {
    throw "VotingPoll address $contractAddress has no bytecode on Anvil. Restart Anvil and rerun npm run setup:local."
  }

  $registryCodeBody = @{
    jsonrpc = "2.0"
    method = "eth_getCode"
    params = @($registryAddress, "latest")
    id = 1
  } | ConvertTo-Json -Compress
  $registryCode = (Invoke-RestMethod -Uri "http://127.0.0.1:8545" -Method Post -ContentType "application/json" -Body $registryCodeBody).result
  if (-not $registryCode -or $registryCode -eq "0x") {
    throw "EncryptedBallotRegistry address $registryAddress has no bytecode on Anvil. Restart Anvil and rerun npm run setup:local."
  }

  Set-EnvValue (Join-Path $BackendDir ".env") "ANVIL_VOTING_CONTRACT_ADDRESS" $contractAddress
  Set-EnvValue (Join-Path $BackendDir ".env") "VOTING_CONTRACT_ADDRESS" $contractAddress
  Set-EnvValue (Join-Path $BackendDir ".env") "C1_ENCRYPTED_BALLOT_REGISTRY_ADDRESS" $registryAddress
  Set-EnvValue (Join-Path $FrontendDir ".env.local") "REACT_APP_CONTRACT_ADDRESS" $contractAddress
  Write-Host "VotingPoll deployed at $contractAddress" -ForegroundColor Green
  Write-Host "EncryptedBallotRegistry deployed at $registryAddress" -ForegroundColor Green
}

Write-Step "Setup complete"
Write-Host "Start both apps with:"
Write-Host "  npm run dev" -ForegroundColor Green
Write-Host ""
Write-Host "Backend:  http://localhost:5000"
Write-Host "Frontend: http://localhost:3000"
Write-Host "Anvil:    http://127.0.0.1:8545"
Write-Host ""
Write-Host "Enable C1 receipt anchoring with:"
Write-Host "  npm run setup:c1:on" -ForegroundColor Green
Write-Host ""
Write-Host "Development OTPs are shown on the registration screen and logged in the backend terminal."
