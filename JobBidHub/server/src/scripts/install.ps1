# JobBid installer (started by "Install JobBid.bat" from the hub). Puts the extension in
# %USERPROFILE%\JobBid and adds a Windows task that keeps it up to date. No admin rights needed.
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
$Hub = '__HUB__'
$Dest = Join-Path $env:USERPROFILE 'JobBid'
$Tool = Join-Path $env:LOCALAPPDATA 'JobBid-Updater'
Write-Host ''
Write-Host "JobBid: installing from $Hub ..."
New-Item -ItemType Directory -Force -Path $Tool | Out-Null
$w = New-Object System.Net.WebClient
if ($Hub -match '^https?://(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)') { $w.Proxy = $null }  # local hub: past any proxy
$upd = Join-Path $Tool 'update.ps1'
$w.DownloadFile("$Hub/api/extension/update.ps1", $upd)
& $upd -Force
Write-Host "Extension files: $Dest"

# A hidden runner (no window pops up), every 30 minutes.
$vbs = Join-Path $Tool 'run.vbs'
Set-Content -Path $vbs -Encoding ASCII -Value ('CreateObject("WScript.Shell").Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -File ""' + $upd + '""", 0, False')
try {
  $action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument ('"' + $vbs + '"')
  $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(2) -RepetitionInterval (New-TimeSpan -Minutes 30)
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
  Register-ScheduledTask -TaskName 'JobBid Updater' -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
  Write-Host 'Auto-update: on (checks the hub every 30 minutes).'
} catch {
  Write-Host ('Auto-update could not be set up: ' + $_.Exception.Message)
  Write-Host 'JobBid will still tell you in its panel when an update is available.'
}

Write-Host ''
Write-Host 'Last step (only once): in Chrome open chrome://extensions, turn on Developer mode,'
Write-Host "click 'Load unpacked' and choose this folder:  $Dest"
Write-Host '(If JobBid was loaded from another folder before, remove that one first.)'
Write-Host ''
Start-Process explorer.exe $Dest
