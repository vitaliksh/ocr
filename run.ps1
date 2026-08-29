param(
    [ValidateRange(1, 65535)]
    [int]$Port = 8010
)

$listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
$projectApp = Join-Path $PSScriptRoot "app.py"
$pidFile = Join-Path $PSScriptRoot ".server-$Port.pid"
$recordedPid = if (Test-Path $pidFile) { (Get-Content -Raw $pidFile).Trim() } else { $null }
foreach ($listener in $listeners) {
    $processId = $listener.OwningProcess
    $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $processId"
    $commandLine = $processInfo.CommandLine

    # Only terminate this project's stale Python server. A different service
    # using the port must be dealt with explicitly rather than being killed.
    $isRecordedProjectServer = $recordedPid -eq [string]$processId
    $isIdentifiedProjectServer = $commandLine -match '(?i)python(?:\.exe)?' -and $commandLine -match [regex]::Escape($projectApp)
    if (-not $isRecordedProjectServer -and -not $isIdentifiedProjectServer) {
        throw "Port $Port is used by PID $processId, which is not this project's app.py. Stop that process yourself or choose another port."
    }

    Write-Host "Stopping stale app.py server (PID $processId) on port $Port..."
    Stop-Process -Id $processId -ErrorAction Stop
}

if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
    throw "Port $Port is still in use after stopping the stale server."
}

$env:PORT = $Port
& py -B "$PSScriptRoot\app.py"
exit $LASTEXITCODE
