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
  if (-not (Test-TcpPort "127.0.0.1" 8545)) {
    Start-Process -FilePath "anvil" -ArgumentList @("--host", "127.0.0.1", "--port", "8545", "--chain-id", "31337") -WindowStyle Hidden
  }
  Wait-ForPort "127.0.0.1" 8545 "Anvil"
}

if (-not $SkipDeploy) {
  Write-Step "Compiling and deploying smart contract to Anvil"
  Push-Location $ContractsDir
  try {
    $env:PRIVATE_KEY = $AnvilPrivateKey
    & npx truffle migrate --network anvil --reset
    if ($LASTEXITCODE -ne 0) {
      throw "Truffle migration failed"
    }

    $contractAddress = node -e "const artifact=require('./build/contracts/VotingPoll.json'); const ids=Object.keys(artifact.networks||{}); if(!ids.length){process.exit(1)}; console.log(artifact.networks[ids[ids.length-1]].address);"
    if (-not $contractAddress) {
      throw "Could not read deployed VotingPoll address"
    }
  } finally {
    Pop-Location
  }

  Set-EnvValue (Join-Path $BackendDir ".env") "ANVIL_VOTING_CONTRACT_ADDRESS" $contractAddress
  Set-EnvValue (Join-Path $BackendDir ".env") "VOTING_CONTRACT_ADDRESS" $contractAddress
  Set-EnvValue (Join-Path $FrontendDir ".env.local") "REACT_APP_CONTRACT_ADDRESS" $contractAddress
  Write-Host "VotingPoll deployed at $contractAddress" -ForegroundColor Green
}

Write-Step "Setup complete"
Write-Host "Start both apps with:"
Write-Host "  npm run dev" -ForegroundColor Green
Write-Host ""
Write-Host "Backend:  http://localhost:5000"
Write-Host "Frontend: http://localhost:3000"
Write-Host "Anvil:    http://127.0.0.1:8545"
Write-Host ""
Write-Host "Development OTPs are shown on the registration screen and logged in the backend terminal."
