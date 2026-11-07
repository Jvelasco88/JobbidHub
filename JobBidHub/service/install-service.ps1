# Makes JobBid Hub start by itself when you sign in to Windows, run hidden in the background, and
# restart after a crash. No window to keep open. Undo with: uninstall-service.ps1
#   Right-click this file > Run with PowerShell   (or: powershell -ExecutionPolicy Bypass -File install-service.ps1)
$ErrorActionPreference = 'Stop'
$name = 'JobBid Hub'
$run = Join-Path $PSScriptRoot 'run-hub.ps1'
$user = "$env:USERDOMAIN\$env:USERNAME"

$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$run`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings -Principal $principal `
  -Description 'Runs JobBid Hub in the background and restarts it if it stops.' -Force | Out-Null

# A hub already running in a start.bat window would hold the port: close it first.
Get-CimInstance Win32_Process -Filter "Name='cmd.exe'" | Where-Object { $_.CommandLine -match 'JobBidHub\\start\.bat|"start\.bat"' } |
  ForEach-Object { taskkill /T /F /PID $_.ProcessId | Out-Null }
Start-Sleep -Seconds 2
Start-ScheduledTask -TaskName $name
Write-Host "JobBid Hub now runs in the background and starts when you sign in to Windows."
Write-Host "Dashboard: http://localhost:4417   Logs: $(Join-Path (Split-Path -Parent $PSScriptRoot) 'logs')"
