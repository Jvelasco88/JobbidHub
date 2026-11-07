# JobBid updater: run by the "JobBid Updater" task every 30 minutes (and once by the installer).
# Asks the hub for the latest extension version and, when it is newer, replaces the files in the
# extension folder. The extension sees the new manifest version and reloads itself.
param([switch]$Force)
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
$Hub = '__HUB__'
$Dest = Join-Path $env:USERPROFILE 'JobBid'
$Tool = Join-Path $env:LOCALAPPDATA 'JobBid-Updater'
$Log = Join-Path $Tool 'update.log'
function Write-Log($m) { try { Add-Content -Path $Log -Value ('{0:yyyy-MM-dd HH:mm:ss}  {1}' -f (Get-Date), $m) } catch {} }
function Get-Ver($s) { try { [version]$s } catch { [version]'0.0' } }
try {
  New-Item -ItemType Directory -Force -Path $Tool | Out-Null
  # A hub on the local network is reached directly (a proxy can't reach it); an internet address uses the normal route.
  $w = New-Object System.Net.WebClient
  if ($Hub -match '^https?://(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)') { $w.Proxy = $null }  # local hub: past any proxy
  $info = $w.DownloadString("$Hub/api/extension/info") | ConvertFrom-Json
  $mf = Join-Path $Dest 'manifest.json'
  $have = '0'
  if (Test-Path $mf) { $have = (Get-Content $mf -Raw | ConvertFrom-Json).version }
  if (-not $Force -and (Get-Ver $info.version) -le (Get-Ver $have)) { exit 0 }

  $tmp = Join-Path $env:TEMP ('jobbid-' + [guid]::NewGuid())
  New-Item -ItemType Directory -Path $tmp | Out-Null
  $zip = Join-Path $tmp 'ext.zip'
  $w.DownloadFile("$Hub/api/extension/download", $zip)
  Expand-Archive -Path $zip -DestinationPath (Join-Path $tmp 'x') -Force
  $src = Join-Path $tmp 'x\JobBid'
  New-Item -ItemType Directory -Force -Path $Dest | Out-Null
  # Everything except manifest.json first: the extension reloads as soon as it sees the new manifest.
  Get-ChildItem -Path $src -Recurse -File | Where-Object { $_.Name -ne 'manifest.json' } | ForEach-Object {
    $rel = $_.FullName.Substring($src.Length + 1)
    $to = Join-Path $Dest $rel
    New-Item -ItemType Directory -Force -Path (Split-Path $to) | Out-Null
    Copy-Item -Path $_.FullName -Destination $to -Force
  }
  Set-Content -Path (Join-Path $Dest 'updater.json') -Encoding ASCII -Value '{"auto": true}'
  Copy-Item -Path (Join-Path $src 'manifest.json') -Destination $mf -Force
  Remove-Item -Path $tmp -Recurse -Force
  Write-Log "Updated $have -> $($info.version)"
} catch {
  Write-Log ('Update check failed: ' + $_.Exception.Message)
  if ($Force) { throw }
}
