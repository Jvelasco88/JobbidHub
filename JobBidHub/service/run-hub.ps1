# Keeps JobBid Hub running in the background: starts it, and starts it again whenever it stops
# (a crash, an update, or the hub asking for a restart). Output goes to JobBidHub\logs\hub-<date>.log.
# Started by the "JobBid Hub" task that install-service.ps1 creates; you can also run it by hand.
$hub = Split-Path -Parent $PSScriptRoot
$logs = Join-Path $hub 'logs'
New-Item -ItemType Directory -Force $logs | Out-Null
$server = Join-Path $hub 'server'
$quickFails = 0

while ($true) {
  # Logs older than 14 days are removed.
  Get-ChildItem $logs -Filter 'hub-*.log' -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-14) } | Remove-Item -Force -ErrorAction SilentlyContinue
  $log = Join-Path $logs ('hub-' + (Get-Date -Format 'yyyy-MM-dd') + '.log')
  Add-Content -Path $log -Encoding utf8 -Value "`r`n=== JobBid Hub starting $(Get-Date -Format 's') ==="
  $started = Get-Date
  # cmd does the redirect, so the hub's own lines go into the log unchanged.
  & cmd.exe /d /c "cd /d `"$server`" && node --disable-warning=ExperimentalWarning src/index.js >> `"$log`" 2>&1"
  $code = $LASTEXITCODE
  Add-Content -Path $log -Encoding utf8 -Value "=== JobBid Hub stopped $(Get-Date -Format 's') (exit code $code) ==="
  # Exit code 3 = the hub asked to restart (office-network switch): straight away.
  if ($code -eq 3) { $quickFails = 0; continue }
  # Stopping again and again within a minute (port in use, missing secret.key...): wait longer each time, up to 5 minutes.
  if (((Get-Date) - $started).TotalSeconds -lt 60) { $quickFails++ } else { $quickFails = 0 }
  Start-Sleep -Seconds ([Math]::Min(300, 5 * [Math]::Pow(2, [Math]::Min($quickFails, 6))))
}
