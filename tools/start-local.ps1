param([switch]$NoBrowser)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$entry = Join-Path $repo 'apps/server/dist/index.js'
$logs = Join-Path $repo '.artifacts/local-server'
$timer = [Diagnostics.Stopwatch]::StartNew()
Set-Location -LiteralPath $repo

function Invoke-Checked([string]$Command, [string[]]$Arguments) {
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Command failed (exit $LASTEXITCODE). See output above." }
}

function Get-ServerStatus {
    Invoke-RestMethod 'http://127.0.0.1:3001/api/agent-settings?brief=true' -TimeoutSec 5
}

try {
    foreach ($command in 'node.exe', 'pnpm', 'npm.cmd', 'git.exe') {
        Get-Command $command -ErrorAction Stop | Out-Null
    }
    # Identify the listener before doing builds. Never terminate an unrelated app.
    $listener = Get-NetTCPConnection -State Listen -LocalPort 3001 -ErrorAction SilentlyContinue |
        Select-Object -First 1
    $previous = $null
    if ($listener) {
        $previous = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)"
        $commandLine = $previous.CommandLine.Replace('\', '/')
        $absoluteEntry = $entry.Replace('\', '/')
        $status = Get-ServerStatus
        $sameWorldRoot = $status.world -and [IO.Path]::GetFullPath($status.world).StartsWith(
            $repo + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)
        $sameEntry = $commandLine.Contains($absoluteEntry) -or
            $commandLine -match '\s["'']?apps/server/dist/index\.js["'']?$'
        if (-not $sameEntry -or -not $sameWorldRoot) { throw 'Port 3001 belongs to another service. Nothing was stopped.' }
        if ($status.busy -or $status.queued -gt 0) { throw 'An agent is working. Wait for the current action to finish, then start again.' }
    }

    Invoke-Checked 'pnpm' @('install', '--frozen-lockfile', '--config.confirmModulesPurge=false')

    $engine = Join-Path $repo 'vendor/pi-rp'
    $engineCli = Join-Path $engine 'packages/coding-agent/dist/cli.js'
    if (-not (Test-Path -LiteralPath (Join-Path $engine 'package.json'))) {
        throw 'Engine checkout missing. Run git submodule update --init --recursive, then start again.'
    }
    # Check the actual checkout, including local source edits; dist never travels with git pull.
    $buildEngine = -not (Test-Path -LiteralPath $engineCli)
    $engineHead = & git.exe -C $engine rev-parse HEAD
    if ($LASTEXITCODE -ne 0) { throw 'Cannot read engine version.' }
    $engineStamp = Join-Path $logs 'engine-head.txt'
    if ((Test-Path -LiteralPath $engineStamp) -and
        (Get-Content -LiteralPath $engineStamp -Raw).Trim() -ne $engineHead) {
        $buildEngine = $true # Also catches commits that only delete source files.
    }
    $installedLock = Join-Path $engine 'node_modules/.package-lock.json'
    $engineLock = Join-Path $engine 'package-lock.json'
    $installEngine = -not (Test-Path -LiteralPath $installedLock)
    if (-not $installEngine) {
        $installEngine = (Get-Item -LiteralPath $engineLock).LastWriteTimeUtc -gt
            (Get-Item -LiteralPath $installedLock).LastWriteTimeUtc
    }
    if (-not $buildEngine) {
        $builtAt = (Get-Item -LiteralPath $engineCli).LastWriteTimeUtc
        $inputs = & git.exe -C $engine ls-files -- 'packages/**/src/**' 'packages/**/package.json' '*config*.json' 'scripts/**' 'package*.json'
        if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect engine build inputs.' }
        foreach ($relative in $inputs) {
            $file = Join-Path $engine $relative
            if ((Test-Path -LiteralPath $file) -and (Get-Item -LiteralPath $file).LastWriteTimeUtc -gt $builtAt) {
                $buildEngine = $true
                break
            }
        }
    }
    if ($installEngine -or $buildEngine) {
        Push-Location -LiteralPath $engine
        try {
            if ($installEngine) { Invoke-Checked 'npm.cmd' @('install') }
            Invoke-Checked 'npm.cmd' @('run', 'hydrate:model-data')
            Invoke-Checked 'npm.cmd' @('run', 'build:offline')
        } finally { Pop-Location }
    }
    New-Item -ItemType Directory -Path $logs -Force | Out-Null
    Set-Content -LiteralPath $engineStamp -Value $engineHead
    Invoke-Checked 'pnpm' @('build')

    # Keep the old service available until the build succeeds, and recheck active work.
    if ($previous) {
        $current = Get-CimInstance Win32_Process -Filter "ProcessId=$($previous.ProcessId)"
        if (-not $current -or $current.CreationDate -ne $previous.CreationDate) {
            throw 'The server process changed during the build. Start again.'
        }
        $status = Get-ServerStatus
        if ($status.busy -or $status.queued -gt 0) { throw 'An agent started working during the build. Wait and start again.' }
        Invoke-Checked 'taskkill.exe' @('/PID', "$($previous.ProcessId)", '/T', '/F')
    }
    New-Item -ItemType Directory -Path $logs -Force | Out-Null
    $env:PORT = '3001'
    # The local (open-source) build mode: config/.env.local, WORLDLINES_LOGIN=on|off there.
    $env:AIRP_DEPLOY = 'local'
    $server = Start-Process -FilePath (Get-Command node.exe).Source -ArgumentList @('"' + $entry + '"') `
        -WorkingDirectory $repo -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $logs 'server.out.log') `
        -RedirectStandardError (Join-Path $logs 'server.err.log')
    $ready = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        $server.Refresh()
        if ($server.HasExited) { throw "Server exited. Read $logs/server.err.log" }
        try {
            $status = Get-ServerStatus
            $bound = Get-NetTCPConnection -State Listen -LocalPort 3001 -ErrorAction SilentlyContinue
            if ($status.writer.model.id -and $bound.OwningProcess -contains $server.Id) { $ready = $true; break }
        } catch { }
        Start-Sleep -Milliseconds 300
    }
    if (-not $ready) { throw "Server did not become ready. Read $logs/server.err.log" }
    Write-Host ("AIRP ready in {0:N1}s: http://localhost:3001/ (PID {1}, model {2})" -f $timer.Elapsed.TotalSeconds, $server.Id, $status.writer.model.id)
    if (-not $NoBrowser) { Start-Process 'http://localhost:3001/' }
} catch {
    Write-Host "AIRP startup failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
