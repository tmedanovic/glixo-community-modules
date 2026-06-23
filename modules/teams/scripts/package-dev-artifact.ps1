# Package glixo.messaging.teams for Manager install (dev/local catalog).
param(
  [string]$ModuleRoot = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'
$dist = Join-Path $ModuleRoot 'dist'
$artifactName = 'glixo-messaging-teams.zip'
$artifactPath = Join-Path $ModuleRoot $artifactName
$manifestPath = Join-Path $ModuleRoot 'glixo.module.json'

Write-Host "Building @glixo/microsoft-native-auth..."
Push-Location (Join-Path (Split-Path -Parent (Split-Path -Parent $ModuleRoot)) 'packages/microsoft-native-auth')
yarn install --silent 2>$null; if ($LASTEXITCODE -ne 0) { npm install --silent }
yarn build
Pop-Location

Write-Host "Building teams module..."
Push-Location $ModuleRoot
yarn install --silent 2>$null; if ($LASTEXITCODE -ne 0) { npm install --silent }
yarn build
Pop-Location

if (-not (Test-Path $dist)) { throw "dist/ missing after build" }

$staging = Join-Path $env:TEMP "glixo-teams-pack-$(Get-Random)"
New-Item -ItemType Directory -Path $staging -Force | Out-Null
Copy-Item -Recurse (Join-Path $ModuleRoot 'dist') (Join-Path $staging 'dist')
Copy-Item -Recurse (Join-Path $ModuleRoot 'migrations') (Join-Path $staging 'migrations')
Copy-Item (Join-Path $ModuleRoot 'glixo.module.json') (Join-Path $staging 'glixo.module.json')
Copy-Item (Join-Path $ModuleRoot 'package.json') (Join-Path $staging 'package.json')
Copy-Item -Recurse (Join-Path $ModuleRoot 'node_modules') (Join-Path $staging 'node_modules')

if (Test-Path $artifactPath) { Remove-Item $artifactPath -Force }
Compress-Archive -Path (Join-Path $staging '*') -DestinationPath $artifactPath
Remove-Item -Recurse -Force $staging

$hash = (Get-FileHash -Path $artifactPath -Algorithm SHA256).Hash.ToLower()
Write-Host "Artifact: $artifactPath"
Write-Host "SHA256: $hash"

$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
$manifest.artifacts[0].sha256 = $hash
$manifest | ConvertTo-Json -Depth 20 | Set-Content $manifestPath -Encoding utf8
Write-Host "Updated glixo.module.json sha256"
