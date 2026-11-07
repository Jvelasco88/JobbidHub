# Stops the background JobBid Hub and removes its start-at-sign-in task. Use start.bat again afterwards.
$name = 'JobBid Hub'
Stop-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue
# The runner and the hub it started.
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'run-hub\.ps1' } | ForEach-Object { taskkill /T /F /PID $_.ProcessId | Out-Null }
Write-Host 'JobBid Hub background task removed.'
