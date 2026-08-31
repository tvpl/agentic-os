# MordomoOS bootstrap for Windows PowerShell: install deps, build, run guided setup.
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Error "Node.js >= 20 is required. Install with: winget install OpenJS.NodeJS.LTS"
}
$major = [int](node -p 'process.versions.node.split(".")[0]')
if ($major -lt 20) {
  Write-Error "Node.js >= 20 is required (found $(node --version))."
}

Write-Host "- Installing dependencies..."
npm install
Write-Host "- Building MordomoOS..."
npm run build
Write-Host "- Starting guided setup (re-runnable, never destroys data)..."
node apps/api/dist/cli.js setup @args
