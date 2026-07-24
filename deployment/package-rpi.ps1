param(
  [string]$OutputName = "hymn-console-rpi.zip"
)

$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$dist = Join-Path $root "dist"
$stage = Join-Path $dist "hymn-console-rpi"
$zip = Join-Path $dist $OutputName

if (-not (Test-Path $dist)) {
  New-Item -ItemType Directory -Path $dist | Out-Null
}

$resolvedDist = Resolve-Path $dist
if ((Test-Path $stage) -and ((Resolve-Path $stage).Path.StartsWith($resolvedDist.Path))) {
  Remove-Item -LiteralPath $stage -Recurse -Force
}
if ((Test-Path $zip) -and ((Resolve-Path $zip).Path.StartsWith($resolvedDist.Path))) {
  Remove-Item -LiteralPath $zip -Force
}

New-Item -ItemType Directory -Path $stage | Out-Null
New-Item -ItemType Directory -Path (Join-Path $stage "data") | Out-Null
New-Item -ItemType Directory -Path (Join-Path $stage "media") | Out-Null

$items = @(
  "server.js",
  "package.json",
  "package-lock.json",
  "README.md",
  "lib",
  "public",
  "deployment",
  "docs",
  "scripts",
  "test"
)

foreach ($item in $items) {
  $source = Join-Path $root $item
  if (Test-Path $source) {
    Copy-Item -LiteralPath $source -Destination $stage -Recurse -Force
  }
}

$settingsPath = Join-Path $root "data\settings.json"
if (Test-Path $settingsPath) {
  $settings = Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json
} else {
  $settings = [pscustomobject]@{}
}

$settings | Add-Member -NotePropertyName openAiApiKey -NotePropertyValue "" -Force
$settings.PSObject.Properties.Remove("adminPinHash")
$settings | Add-Member -NotePropertyName displayMode -NotePropertyValue "standard" -Force
$settings | Add-Member -NotePropertyName dnsName -NotePropertyValue "hymnconsole" -Force
$settings | Add-Member -NotePropertyName highContrast -NotePropertyValue $false -Force
$settings | Add-Member -NotePropertyName kioskMode -NotePropertyValue $false -Force
$settings | Add-Member -NotePropertyName autoBackup -NotePropertyValue $false -Force
$settings | Add-Member -NotePropertyName storage -NotePropertyValue ([pscustomobject]@{
  mode = "internal"
  usbPath = ""
}) -Force
$settings | Add-Member -NotePropertyName backup -NotePropertyValue ([pscustomobject]@{
  targetPath = ""
  retentionDays = 14
}) -Force
$settings | Add-Member -NotePropertyName network -NotePropertyValue ([pscustomobject]@{
  mode = "dhcp"
  preferredUrl = ""
  dnsName = "hymnconsole"
  subnet = ""
  gateway = ""
  notes = ""
}) -Force
$settings | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath (Join-Path $stage "data\settings.json") -Encoding UTF8

"[]" | Set-Content -LiteralPath (Join-Path $stage "data\library.json") -Encoding UTF8
"[]" | Set-Content -LiteralPath (Join-Path $stage "data\service-plans.json") -Encoding UTF8
"[]" | Set-Content -LiteralPath (Join-Path $stage "data\service-queue.json") -Encoding UTF8

Compress-Archive -Path $stage -DestinationPath $zip -Force

Write-Host "Created package: $zip"
