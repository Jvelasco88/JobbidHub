# Restarts the background JobBid Hub (after an update). The runner starts it again within seconds.
# taskkill /T also stops the hub's Cloudflare tunnel, so no second tunnel is left behind.
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'src[\\/]index\.js' -and $_.CommandLine -notmatch 'vite' } |
  ForEach-Object { taskkill /T /F /PID $_.ProcessId | Out-Null }
Write-Host 'JobBid Hub is restarting...'
