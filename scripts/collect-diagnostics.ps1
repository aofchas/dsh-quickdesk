<#
.SYNOPSIS
  QuickDesk one-click diagnostics collector for Windows.

.DESCRIPTION
  Collects everything needed to diagnose "QuickDesk global hotkey does not work"
  on a Windows machine:

    * environment / OS / PowerShell / DSH version information
    * DSH profiles, plugin install versions and the quickdesk patch row
    * QuickDesk sidecar process list, launcher.log and install files
    * launcher prerequisites: Add-Type assemblies, C# compile, Global\ mutex
    * a short-lived hidden launcher smoke test (skipped if a sidecar already runs)
    * a plain-Node import test of the installed quickdesk.mjs (module resolution)
    * recent DSH log files (redacted-free, but local only) and matching error lines
    * a human-readable summary with a verdict

  The collector does not change DSH or QuickDesk configuration. Its only side
  effect is the optional hidden launcher smoke test (a PowerShell sidecar with
  the temporary hotkey Ctrl+Alt+F19, killed after a few seconds).

.PARAMETER NoSmokeTest
  Do not start the hidden launcher smoke test.

.PARAMETER OutputZip
  Full path for the report zip. When omitted, a native Save-As dialog asks the
  user where to store the report; canceling the dialog exits without writing.

.EXAMPLE
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\collect-diagnostics.ps1

.EXAMPLE
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\collect-diagnostics.ps1 -OutputZip C:\Temp\qd.zip -NoSmokeTest
#>
[CmdletBinding()]
param(
  [string]$OutputZip = '',
  [switch]$NoSmokeTest
)

$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'

$script:errors = New-Object System.Collections.Generic.List[string]
$script:launcherProcesses = @()
$script:launcherLogPath = $null
$script:launcherLogFound = $false
$script:launcherPath = $null
$script:smokeResult = 'skipped'
$script:smokeOk = $false
$script:addTypeOk = $false
$script:mutexTestOk = $false
$script:importTests = @()
$script:dshVersionLines = @()

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$computer = if ($env:COMPUTERNAME) { $env:COMPUTERNAME } else { 'unknown' }
$desktop = [Environment]::GetFolderPath('Desktop')
if ([string]::IsNullOrWhiteSpace($desktop) -or -not (Test-Path $desktop)) { $desktop = $env:USERPROFILE }

# Collect into a private temp folder; only the final zip is kept.
$tempRoot = Join-Path $env:TEMP ("QuickDesk-Diagnostics-" + [Guid]::NewGuid().ToString('N'))
$out = Join-Path $tempRoot 'report'
New-Item -ItemType Directory -Path $out -Force | Out-Null

$zipPath = ''
if (-not [string]::IsNullOrWhiteSpace($OutputZip)) {
  try {
    $zipPath = [System.IO.Path]::GetFullPath($OutputZip)
  } catch {
    $zipPath = $OutputZip
  }
} else {
  try {
    Add-Type -AssemblyName System.Windows.Forms -ErrorAction Stop
    $dialog = New-Object System.Windows.Forms.SaveFileDialog
    $dialog.Title = 'Save QuickDesk diagnostics report'
    $dialog.Filter = 'Zip archive (*.zip)|*.zip'
    $dialog.AddExtension = $true
    $dialog.DefaultExt = 'zip'
    $dialog.InitialDirectory = $desktop
    $dialog.FileName = "QuickDesk-Diagnostics-$computer-$stamp.zip"
    $result = $dialog.ShowDialog()
    if ($result -ne [System.Windows.Forms.DialogResult]::OK -or [string]::IsNullOrWhiteSpace($dialog.FileName)) {
      $cancelJson = @{ ok = $false; canceled = $true; zip = ''; temp = '' } | ConvertTo-Json -Compress
      Write-Output ("QUICKDESK_DIAGNOSTICS_JSON: " + $cancelJson)
      exit 0
    }
    $zipPath = $dialog.FileName
  } catch {
    $dialogJson = @{ ok = $false; canceled = $false; error = ('Could not open the save dialog: ' + $_.Exception.Message); zip = ''; temp = '' } | ConvertTo-Json -Compress
    Write-Output ("QUICKDESK_DIAGNOSTICS_JSON: " + $dialogJson)
    exit 1
  }
}
$zipDir = Split-Path -Parent $zipPath
if (-not [string]::IsNullOrWhiteSpace($zipDir) -and -not (Test-Path $zipDir)) {
  New-Item -ItemType Directory -Path $zipDir -Force | Out-Null
}

function Write-Section {
  param([string]$Name, [scriptblock]$Body)
  try {
    $text = (& $Body 2>&1 | Out-String -Width 400)
    Set-Content -LiteralPath (Join-Path $out $Name) -Value $text -Encoding UTF8
  } catch {
    $script:errors.Add("${Name}: $($_.Exception.Message)")
    Set-Content -LiteralPath (Join-Path $out $Name) -Value ("SECTION FAILED: " + $_.Exception.Message) -Encoding UTF8
  }
}

function Write-TextFile {
  param([string]$Name, [string[]]$Lines)
  try {
    Set-Content -LiteralPath (Join-Path $out $Name) -Value ($Lines -join "`r`n") -Encoding UTF8
  } catch {
    $script:errors.Add("${Name}: $($_.Exception.Message)")
  }
}

function Get-CommandText {
  param([string]$Exe, [string[]]$Arguments = @())
  try { (& $Exe @Arguments 2>&1 | Out-String -Width 400).Trim() }
  catch { "ERROR: $($_.Exception.Message)" }
}

function Find-DshRoots {
  $roots = @()
  try {
    foreach ($p in (Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)) {
      if ($p.Name -ne 'DeepSeek Harness.exe' -and $p.Name -ne 'dsh.exe') { continue }
      if ($p.CommandLine -match '"([^"]+\.exe)"') {
        $roots += (Split-Path $Matches[1] -Parent)
      }
    }
  } catch { }
  $roots += @(
    'D:\Program Files\dsh',
    'D:\Program Files\DeepSeek Harness',
    (Join-Path $env:LOCALAPPDATA 'Programs\dsh'),
    (Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness'),
    'C:\Program Files\dsh',
    'C:\Program Files\DeepSeek Harness'
  )
  return ($roots | Where-Object { $_ -and (Test-Path $_) } | Sort-Object -Unique)
}

function Find-DshNode {
  $candidates = @()
  foreach ($root in (Find-DshRoots)) {
    $candidates += (Join-Path $root 'resources\runtime\primary-runtime\dependencies\node\bin\node.exe')
    $candidates += (Join-Path $root 'resources\runtime\primary-runtime\dependencies\node\node.exe')
  }
  foreach ($c in $candidates) {
    if (Test-Path $c) { return $c }
  }
  foreach ($root in (Find-DshRoots)) {
    $runtime = Join-Path $root 'resources\runtime'
    if (-not (Test-Path $runtime)) { continue }
    $node = Get-ChildItem $runtime -Recurse -Filter node.exe -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($node) { return $node.FullName }
  }
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  return $null
}

function Find-QuickDeskInstalls {
  $items = @()
  $profilesRoot = Join-Path $env:USERPROFILE '.dsh\profiles'
  if (-not (Test-Path $profilesRoot)) { return $items }
  foreach ($profile in (Get-ChildItem $profilesRoot -Directory -ErrorAction SilentlyContinue)) {
    $plugin = Join-Path $profile.FullName 'node_modules\dsh-quickdesk'
    if (Test-Path $plugin) {
      $items += [pscustomobject]@{
        Profile    = $profile.Name
        ProfileDir = $profile.FullName
        PluginDir  = $plugin
      }
    }
  }
  return $items
}

Write-Host ''
Write-Host 'QuickDesk diagnostics collector'
Write-Host "Output folder: $out"
Write-Host ''

# ---------------------------------------------------------------------------
# 1. Environment
# ---------------------------------------------------------------------------
Write-Section 'environment.txt' {
  $admin = $false
  try {
    $admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
      [Security.Principal.WindowsBuiltInRole]::Administrator)
  } catch { }
  $lines = @(
    "Collected: $((Get-Date).ToString('o'))",
    "Computer: $computer",
    "User: $([Security.Principal.WindowsIdentity]::GetCurrent().Name)",
    "UserProfile: $env:USERPROFILE",
    "LocalAppData: $env:LOCALAPPDATA",
    "IsAdmin: $admin",
    "OS: $([Environment]::OSVersion.VersionString)",
    "PSVersion: $($PSVersionTable.PSVersion)",
    "CLR: $($PSVersionTable.CLRVersion)",
    "Culture: $((Get-Culture).Name) / UI: $((Get-UICulture).Name)",
    "DefaultEncoding: $([System.Text.Encoding]::Default.WebName)",
    "ConsoleOutputEncoding: $([Console]::OutputEncoding.WebName)",
    "Temp: $env:TEMP",
    '',
    '--- ExecutionPolicy ---',
    (Get-ExecutionPolicy -List | Out-String -Width 200),
    '--- powershell.exe lookup ---',
    (Get-Command powershell.exe -ErrorAction SilentlyContinue | Out-String -Width 200),
    '--- PATH entries containing WindowsPowerShell / System32 ---'
  )
  foreach ($entry in ($env:PATH -split ';')) {
    if ($entry -match 'WindowsPowerShell|System32') { $lines += "  $entry" }
  }
  $lines
}

# ---------------------------------------------------------------------------
# 2. DSH version / installation
# ---------------------------------------------------------------------------
Write-Section 'dsh-version.txt' {
  $lines = @()
  $lines += '=== Running DSH processes ==='
  try {
    foreach ($p in (Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.Name -eq 'DeepSeek Harness.exe' -or $_.Name -eq 'dsh.exe' })) {
      $lines += "PID=$($p.ProcessId) PPID=$($p.ParentProcessId)"
      $lines += "  $($p.CommandLine)"
    }
  } catch {
    $lines += "ERROR: $($_.Exception.Message)"
  }
  $lines += ''
  $lines += '=== Installed DSH roots ==='
  foreach ($root in (Find-DshRoots)) {
    $exe = Join-Path $root 'DeepSeek Harness.exe'
    $lines += "ROOT: $root"
    if (Test-Path $exe) {
      try {
        $vi = (Get-Item $exe).VersionInfo
        $lines += "  ProductVersion=$($vi.ProductVersion) FileVersion=$($vi.FileVersion)"
      } catch { $lines += "  VersionInfo ERROR: $($_.Exception.Message)" }
    } else {
      $lines += '  DeepSeek Harness.exe: MISSING'
    }
    $cli = Join-Path $root 'resources\runtime\cli\bin\dsh.cmd'
    $lines += "  CLI: $cli exists=$(Test-Path $cli)"
    if (Test-Path $cli) {
      $versionText = (Get-CommandText -Exe $cli -Arguments @('--version'))
      $lines += '  dsh --version:'
      $lines += ($versionText -split "`r?`n" | ForEach-Object { "    $_" })
      $script:dshVersionLines += $versionText
    }
  }
  $cmd = Get-Command dsh -ErrorAction SilentlyContinue
  if ($cmd) {
    $lines += ''
    $lines += "dsh on PATH: $($cmd.Source)"
    $versionText = (Get-CommandText -Exe $cmd.Source -Arguments @('--version'))
    $lines += $versionText
    $script:dshVersionLines += $versionText
  }
  $lines
}

# ---------------------------------------------------------------------------
# 3. DSH profiles / config
# ---------------------------------------------------------------------------
Write-Section 'profiles.txt' {
  $lines = @()
  $profilesRoot = Join-Path $env:USERPROFILE '.dsh\profiles'
  $lines += "profilesRoot: $profilesRoot exists=$(Test-Path $profilesRoot)"
  if (-not (Test-Path $profilesRoot)) { return $lines }
  foreach ($profile in (Get-ChildItem $profilesRoot -Directory -ErrorAction SilentlyContinue)) {
    $lines += ''
    $lines += "=== profile: $($profile.Name) ==="
    foreach ($name in @('package.json', 'cordis.patch.yml', 'hub.log')) {
      $file = Join-Path $profile.FullName $name
      if (Test-Path $file) {
        $lines += "--- $name ---"
        try { $lines += (Get-Content -LiteralPath $file -Raw) }
        catch { $lines += "READ ERROR: $($_.Exception.Message)" }
      }
    }
    $quickdeskPackage = Join-Path $profile.FullName 'node_modules\dsh-quickdesk\package.json'
    if (Test-Path $quickdeskPackage) {
      $lines += '--- dsh-quickdesk/package.json ---'
      try { $lines += (Get-Content -LiteralPath $quickdeskPackage -Raw) }
      catch { $lines += "READ ERROR: $($_.Exception.Message)" }
    }
  }
  $lines
}

# ---------------------------------------------------------------------------
# 4. QuickDesk install files
# ---------------------------------------------------------------------------
Write-Section 'quickdesk-install.txt' {
  $lines = @()
  $installs = @(Find-QuickDeskInstalls)
  $lines += "QuickDesk installs found: $($installs.Count)"
  foreach ($item in $installs) {
    $lines += ''
    $lines += "=== profile: $($item.Profile) ==="
    $lines += "PluginDir: $($item.PluginDir)"
    $packageJson = Join-Path $item.PluginDir 'package.json'
    if (Test-Path $packageJson) {
      try {
        $json = Get-Content -LiteralPath $packageJson -Raw | ConvertFrom-Json
        $lines += "version: $($json.version)"
        $lines += "type: $($json.type)"
        $lines += "main: $($json.main)"
      } catch { $lines += "package.json parse ERROR: $($_.Exception.Message)" }
    }
    $launcher = Join-Path $item.PluginDir 'scripts\launcher.ps1'
    $lines += "launcher.ps1 exists: $(Test-Path $launcher)"
    if (Test-Path $launcher) {
      $lines += "launcher.ps1 size: $((Get-Item -LiteralPath $launcher).Length)"
      try {
        $hash = Get-FileHash -LiteralPath $launcher -Algorithm SHA256
        $lines += "launcher.ps1 SHA256: $($hash.Hash)"
      } catch { $lines += "launcher.ps1 hash ERROR: $($_.Exception.Message)" }
      try {
        $bytes = [System.IO.File]::ReadAllBytes($launcher)
        $head = @()
        foreach ($i in 0..([Math]::Min(3, $bytes.Length - 1))) { $head += $bytes[$i].ToString('X2') }
        $lines += "launcher.ps1 first bytes: $($head -join ' ')"
      } catch { }
    }
    $lines += "schemastery in profile node_modules: $(Test-Path (Join-Path $item.ProfileDir 'node_modules\@deepseek-ai\schemastery'))"
    $lines += "schemastery inside plugin node_modules: $(Test-Path (Join-Path $item.PluginDir 'node_modules\@deepseek-ai\schemastery'))"
    $lines += '--- files (top 80) ---'
    try {
      $count = 0
      foreach ($f in (Get-ChildItem -LiteralPath $item.PluginDir -Recurse -File -ErrorAction SilentlyContinue | Sort-Object FullName)) {
        if ($count -ge 80) { $lines += '... (truncated)'; break }
        $lines += ("{0,10}  {1:yyyy-MM-dd HH:mm:ss}  {2}" -f $f.Length, $f.LastWriteTime, $f.FullName)
        $count += 1
      }
    } catch { $lines += "file listing ERROR: $($_.Exception.Message)" }
  }
  $lines
}

# ---------------------------------------------------------------------------
# 5. Processes
# ---------------------------------------------------------------------------
Write-Section 'processes.txt' {
  $lines = @()
  $lines += '=== QuickDesk sidecar processes (powershell.exe + launcher.ps1) ==='
  try {
    $launchers = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -eq 'powershell.exe' -and $_.CommandLine -like '*launcher.ps1*' })
    $script:launcherProcesses = $launchers
    if ($launchers.Count -eq 0) {
      $lines += 'NONE'
    } else {
      foreach ($p in $launchers) {
        $lines += "PID=$($p.ProcessId) PPID=$($p.ParentProcessId) START=$($p.CreationDate)"
        $lines += "  $($p.CommandLine)"
      }
    }
  } catch {
    $lines += "ERROR: $($_.Exception.Message)"
  }
  $lines += ''
  $lines += '=== DSH processes ==='
  try {
    foreach ($p in (Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.Name -eq 'DeepSeek Harness.exe' -or $_.Name -eq 'dsh.exe' })) {
      $lines += "PID=$($p.ProcessId) PPID=$($p.ParentProcessId) START=$($p.CreationDate)"
      $lines += "  $($p.CommandLine)"
    }
  } catch {
    $lines += "ERROR: $($_.Exception.Message)"
  }
  $lines += ''
  $lines += '=== Other powershell.exe processes (filtered) ==='
  try {
    foreach ($p in (Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.Name -eq 'powershell.exe' })) {
      $lines += "PID=$($p.ProcessId) PPID=$($p.ParentProcessId) $($p.CommandLine)"
    }
  } catch {
    $lines += "ERROR: $($_.Exception.Message)"
  }
  $lines
}

# ---------------------------------------------------------------------------
# 4b. Pick the launcher that belongs to the active profile / running sidecar
# ---------------------------------------------------------------------------
$allInstalls = @(Find-QuickDeskInstalls)
$chosenInstall = $null
if ($script:launcherProcesses.Count -gt 0) {
  $runningCommandLine = [string]$script:launcherProcesses[0].CommandLine
  if ($runningCommandLine -match '-File\s+"?([^"]+launcher\.ps1)"?') {
    $runningLauncher = $Matches[1]
    foreach ($item in $allInstalls) {
      $candidate = Join-Path $item.PluginDir 'scripts\launcher.ps1'
      if ($candidate -ieq $runningLauncher) { $chosenInstall = $item; break }
    }
  }
}
if (-not $chosenInstall) {
  $chosenInstall = $allInstalls | Where-Object { $_.Profile -eq 'desktop' } | Select-Object -First 1
}
if (-not $chosenInstall) {
  $chosenInstall = $allInstalls | Select-Object -First 1
}
if ($chosenInstall) {
  $script:launcherPath = Join-Path $chosenInstall.PluginDir 'scripts\launcher.ps1'
}

# ---------------------------------------------------------------------------
# 6. launcher.log (all likely locations)
# ---------------------------------------------------------------------------
Write-Section 'launcher-log.txt' {
  $lines = @()
  $candidates = @()
  $candidates += (Join-Path $env:LOCALAPPDATA 'dsh-quickdesk\launcher.log')
  $usersRoot = 'C:\Users'
  if (Test-Path $usersRoot) {
    foreach ($u in (Get-ChildItem $usersRoot -Directory -ErrorAction SilentlyContinue)) {
      $candidates += (Join-Path $u.FullName 'AppData\Local\dsh-quickdesk\launcher.log')
    }
  }
  $candidates = $candidates | Sort-Object -Unique
  $lines += 'Checked locations:'
  foreach ($c in $candidates) { $lines += "  $c" }
  $lines += ''
  foreach ($c in $candidates) {
    if (Test-Path $c) {
      $script:launcherLogFound = $true
      $script:launcherLogPath = $c
      $item = Get-Item -LiteralPath $c
      $lines += "FOUND: $c"
      $lines += "  size=$($item.Length) lastWrite=$($item.LastWriteTime.ToString('o'))"
      $lines += '--- last 500 lines ---'
      try { $lines += (Get-Content -LiteralPath $c -Tail 500) }
      catch { $lines += "READ ERROR: $($_.Exception.Message)" }
      try { Copy-Item -LiteralPath $c -Destination (Join-Path $out 'launcher.log') -Force }
      catch { $script:errors.Add("copy launcher.log: $($_.Exception.Message)") }
      break
    }
  }
  if (-not $script:launcherLogFound) {
    $lines += 'MISSING: no launcher.log found in any checked location.'
    $lines += 'This usually means the QuickDesk sidecar never started on this machine.'
  }
  $lines
}

# ---------------------------------------------------------------------------
# 7. Launcher prerequisites: assemblies, C# compile, named mutex, spawn test
# ---------------------------------------------------------------------------
Write-Section 'launcher-prerequisites.txt' {
  $lines = @()
  $lines += '=== Add-Type System.Windows.Forms ==='
  try {
    Add-Type -AssemblyName System.Windows.Forms -ErrorAction Stop
    $lines += 'OK'
  } catch {
    $lines += "ERROR: $($_.Exception.Message)"
  }
  $lines += '=== Add-Type System.Drawing ==='
  try {
    Add-Type -AssemblyName System.Drawing -ErrorAction Stop
    $lines += 'OK'
  } catch {
    $lines += "ERROR: $($_.Exception.Message)"
  }
  $lines += '=== C# compile smoke test (same mechanism as launcher.ps1) ==='
  try {
    $source = 'public static class QuickDeskDiagSmoke { public static string Ping() { return "pong"; } }'
    Add-Type -TypeDefinition $source -ErrorAction Stop
    $pong = [QuickDeskDiagSmoke]::Ping()
    $lines += "OK: $pong"
    $script:addTypeOk = $true
  } catch {
    $lines += "ERROR: $($_.Exception.ToString())"
  }
  $lines += '=== Global named mutex test ==='
  $mutexName = 'Global\dsh-quickdesk-diag-' + [Guid]::NewGuid().ToString('N')
  try {
    $m = New-Object System.Threading.Mutex($false, $mutexName)
    $lines += "Create OK: $mutexName"
    $script:mutexTestOk = $true
    try { $m.Dispose() } catch { }
  } catch {
    $lines += "Create ERROR: $($_.Exception.ToString())"
  }
  try {
    $existing = [System.Threading.Mutex]::OpenExisting('Global\dsh-quickdesk-sidecar')
    $lines += 'OpenExisting(Global\dsh-quickdesk-sidecar): EXISTS (some process/handle owns the name)'
    try { $existing.Dispose() } catch { }
  } catch [System.Threading.WaitHandleCannotBeOpenedException] {
    $lines += 'OpenExisting(Global\dsh-quickdesk-sidecar): NOT FOUND'
  } catch {
    $lines += "OpenExisting ERROR: $($_.Exception.Message)"
  }
  $lines += '=== PowerShell child process spawn test ==='
  try {
    $spawnOut = (& powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command 'Write-Output "spawn-ok"; exit 0' 2>&1 | Out-String).Trim()
    $lines += "ExitCode=$LASTEXITCODE Output=$spawnOut"
  } catch {
    $lines += "ERROR: $($_.Exception.Message)"
  }
  $lines
}

# ---------------------------------------------------------------------------
# 8. Hidden launcher smoke test
# ---------------------------------------------------------------------------
if ($NoSmokeTest) {
  $script:smokeResult = 'skipped (-NoSmokeTest)'
} elseif ($script:launcherProcesses.Count -gt 0) {
  $script:smokeResult = "skipped (a sidecar is already running: PID $($script:launcherProcesses[0].ProcessId))"
} elseif (-not $script:launcherPath) {
  $script:smokeResult = 'skipped (launcher.ps1 not found)'
} else {
  try {
    $smokeDir = Join-Path $out 'launcher-smoke'
    New-Item -ItemType Directory -Path $smokeDir -Force | Out-Null
    $stdoutFile = Join-Path $smokeDir 'stdout.txt'
    $stderrFile = Join-Path $smokeDir 'stderr.txt'
    $arguments = '-NoLogo -NoProfile -NonInteractive -STA -ExecutionPolicy Bypass -File "' + $script:launcherPath + '" -Hotkey Ctrl+Alt+F19'
    $process = Start-Process -FilePath 'powershell.exe' -ArgumentList $arguments -WindowStyle Hidden `
      -RedirectStandardOutput $stdoutFile -RedirectStandardError $stderrFile -PassThru
    Write-Host ("  smoke test: started launcher (pid {0}), waiting 8s..." -f $process.Id)
    Start-Sleep -Seconds 8
    $exited = $process.HasExited
    $exitCode = $null
    if ($exited) { try { $exitCode = $process.ExitCode } catch { } }
    if (-not $exited) {
      $script:smokeOk = $true
      try { Stop-Process -Id $process.Id -Force -ErrorAction Stop } catch { }
    }
    Start-Sleep -Milliseconds 700
    $script:smokeResult = "started pid=$($process.Id); exitedWithin8s=$exited; exitCode=$exitCode"
    $lines = @(
      "smoke test: $($script:smokeResult)",
      'The smoke test uses the temporary hotkey Ctrl+Alt+F19.',
      '',
      '=== stdout ===',
      (Get-Content -LiteralPath $stdoutFile -Raw -ErrorAction SilentlyContinue),
      '=== stderr ===',
      (Get-Content -LiteralPath $stderrFile -Raw -ErrorAction SilentlyContinue)
    )
    Set-Content -LiteralPath (Join-Path $smokeDir 'result.txt') -Value ($lines -join "`r`n") -Encoding UTF8
    # launcher.log if the smoke test created it
    if (-not $script:launcherLogFound) {
      $candidateLog = Join-Path $env:LOCALAPPDATA 'dsh-quickdesk\launcher.log'
      if (Test-Path $candidateLog) {
        $script:launcherLogFound = $true
        $script:launcherLogPath = $candidateLog
        try { Copy-Item -LiteralPath $candidateLog -Destination (Join-Path $out 'launcher.log') -Force } catch { }
      }
    }
    if ($script:launcherLogFound) {
      $tailFile = Join-Path $smokeDir 'launcher-log-after-smoke.txt'
      try { Get-Content -LiteralPath $script:launcherLogPath -Tail 120 | Set-Content -LiteralPath $tailFile -Encoding UTF8 } catch { }
    }
  } catch {
    $script:smokeResult = "failed to start smoke test: $($_.Exception.Message)"
    $script:errors.Add("smoke test: $($_.Exception.Message)")
  }
}

# ---------------------------------------------------------------------------
# 9. Plain-Node import test for each installed quickdesk.mjs
# ---------------------------------------------------------------------------
Write-Section 'plugin-import.txt' {
  $lines = @()
  $node = Find-DshNode
  $lines += "DSH bundled node: $(if ($node) { $node } else { 'NOT FOUND' })"
  $installs = @(Find-QuickDeskInstalls)
  $urls = @()
  foreach ($item in $installs) {
    $main = Join-Path $item.PluginDir 'quickdesk.mjs'
    if (Test-Path $main) {
      $url = 'file:///' + ($main -replace '\\', '/')
      $urls += $url
      $lines += "profile $($item.Profile): $url"
    }
  }
  if (-not $node) {
    $lines += 'SKIP: node.exe not found (neither in the DSH runtime nor on PATH).'
    return $lines
  }
  if ($urls.Count -eq 0) {
    $lines += 'SKIP: no quickdesk.mjs found.'
    return $lines
  }
  $helper = Join-Path $out 'import-test.mjs'
  $helperSource = @'
const urls = process.argv.slice(2);
for (const url of urls) {
  try {
    const mod = await import(url);
    console.log('IMPORT_OK ' + url + ' apply=' + typeof mod.apply);
  } catch (error) {
    console.log('IMPORT_FAIL ' + url);
    console.log('  ' + String(error && error.message ? error.message : error));
  }
}
'@
  Set-Content -LiteralPath $helper -Value $helperSource -Encoding UTF8
  $output = (& $node $helper @urls 2>&1 | Out-String -Width 400)
  $lines += ''
  $lines += '=== import results ==='
  $lines += $output
  foreach ($line in ($output -split "`r?`n")) {
    if ($line -match '^IMPORT_(OK|FAIL)') { $script:importTests += $line }
  }
  $lines += ''
  $lines += 'NOTE: a plain-Node IMPORT_FAIL can mean the plugin relies on the DSH'
  $lines += 'loader to resolve a package (for example @deepseek-ai/schemastery).'
  $lines += 'It is still a strong signal when the same import succeeds on a linked'
  $lines += 'development install.'
  $lines
}

# ---------------------------------------------------------------------------
# 10. Recent DSH log files
# ---------------------------------------------------------------------------
$logsDir = Join-Path $out 'dsh-logs'
New-Item -ItemType Directory -Path $logsDir -Force | Out-Null
$logRoots = @(
  (Join-Path $env:APPDATA '@deepseek-ai\dsh-desktop'),
  (Join-Path $env:LOCALAPPDATA '@deepseek-ai\dsh-desktop')
)
$copiedLogs = @()
foreach ($root in ($logRoots | Where-Object { $_ -and (Test-Path $_) } | Sort-Object -Unique)) {
  try {
    $files = Get-ChildItem -LiteralPath $root -Recurse -File -ErrorAction SilentlyContinue | Where-Object {
      $ext = $_.Extension.ToLowerInvariant()
      ($ext -eq '.log' -or $ext -eq '.txt') -and
      $_.Length -lt 1MB -and
      $_.LastWriteTime -gt (Get-Date).AddDays(-14) -and
      $_.FullName -notmatch '\\node_modules\\|\\sessions\\|\\attachments\\|\\cache\\|\\GPUCache\\|\\Code Cache\\|\\blob_storage\\|\\Local Storage\\|\\Session Storage\\|\\dsh-runtimes\\|\\dsh-ops\\|\\shells\\|\\pnpm\\'
    } | Select-Object -First 40
    $rootName = Split-Path $root -Leaf
    foreach ($file in $files) {
      $relative = $file.FullName.Substring($root.Length).TrimStart('\')
      $dest = Join-Path $logsDir (Join-Path $rootName $relative)
      $destDir = Split-Path $dest -Parent
      if (-not (Test-Path $destDir)) { New-Item -ItemType Directory -Path $destDir -Force | Out-Null }
      Copy-Item -LiteralPath $file.FullName -Destination $dest -Force -ErrorAction SilentlyContinue
      $copiedLogs += $dest
    }
  } catch {
    $script:errors.Add("log scan ${root}: $($_.Exception.Message)")
  }
}
try {
  $grepLines = @()
  foreach ($log in $copiedLogs) {
    try {
      $matches = Select-String -LiteralPath $log -Pattern 'quickdesk|sidecar|plugin.*(error|fail|exception)|error.*plugin' -AllMatches -ErrorAction SilentlyContinue
      foreach ($m in $matches) {
        $grepLines += ("{0}:{1}: {2}" -f $log, $m.LineNumber, $m.Line.Trim())
        if ($grepLines.Count -ge 800) { break }
      }
    } catch { }
    if ($grepLines.Count -ge 800) { break }
  }
  if ($grepLines.Count -eq 0) { $grepLines += 'No matching lines (quickdesk/sidecar/plugin error) in collected logs.' }
  Set-Content -LiteralPath (Join-Path $out 'dsh-log-grep.txt') -Value ($grepLines -join "`r`n") -Encoding UTF8
} catch {
  $script:errors.Add("log grep: $($_.Exception.Message)")
}
$operations = Join-Path $env:APPDATA '@deepseek-ai\dsh-desktop\plugin-operations\operations.jsonl'
if (Test-Path $operations) {
  try { Copy-Item -LiteralPath $operations -Destination (Join-Path $out 'plugin-operations.jsonl') -Force } catch { }
}

# ---------------------------------------------------------------------------
# 11. Summary
# ---------------------------------------------------------------------------
Write-TextFile 'README.txt' @(
  'QuickDesk diagnostics bundle',
  '',
  'This folder was created by collect-diagnostics.ps1.',
  'Send the whole zip to the QuickDesk developer if the hotkey does not work.',
  '',
  'Important files:',
  '  summary.txt              - short verdict and key facts',
  '  environment.txt          - Windows / PowerShell / locale / encoding',
  '  dsh-version.txt          - DSH installation and version',
  '  profiles.txt             - DSH profiles, configs and hub.log',
  '  quickdesk-install.txt    - QuickDesk install path/version/launcher files',
  '  processes.txt            - running DSH and QuickDesk sidecar processes',
  '  launcher-log.txt         - QuickDesk sidecar log (or MISSING)',
  '  launcher-prerequisites.txt - Add-Type / C# compile / mutex / spawn tests',
  '  launcher-smoke/          - hidden launcher startup test result',
  '  plugin-import.txt        - plain-Node import test of quickdesk.mjs',
  '  dsh-logs/                - recent DSH logs (may be empty)',
  '  dsh-log-grep.txt         - matching error lines from those logs',
  '',
  'Privacy: the bundle can contain local paths, user names and process command',
  'lines. Treat it as private and share it only with the developer.'
)

$summary = @()
$summary += 'QuickDesk diagnostics summary'
$summary += '============================'
$summary += "Collected: $((Get-Date).ToString('o'))"
$summary += "Computer: $computer"
$summary += "Output folder: $out"
$summary += ''
$summary += "DSH version hints:"
if ($script:dshVersionLines.Count -eq 0) {
  $summary += '  (not detected)'
} else {
  foreach ($line in $script:dshVersionLines) {
    foreach ($part in ($line -split "`r?`n")) { if ($part.Trim()) { $summary += "  $($part.Trim())" } }
  }
}
$summary += ''
$summary += "QuickDesk installs:"
$installs = @(Find-QuickDeskInstalls)
if ($installs.Count -eq 0) { $summary += '  none found under ~/.dsh/profiles' }
foreach ($item in $installs) { $summary += "  $($item.Profile): $($item.PluginDir)" }
$summary += ''
$summary += "launcher.ps1: $(if ($script:launcherPath) { $script:launcherPath } else { 'NOT FOUND' })"
$summary += "launcher.log found: $($script:launcherLogFound) $(if ($script:launcherLogPath) { "($script:launcherLogPath)" } else { '' })"
$sidecarCount = @($script:launcherProcesses).Count
$summary += "sidecar processes now: $sidecarCount"
foreach ($p in $script:launcherProcesses) { $summary += "  PID=$($p.ProcessId) $($p.CommandLine)" }
$summary += "Add-Type / C# compile OK: $($script:addTypeOk)"
$summary += "Global named mutex create OK: $($script:mutexTestOk)"
$summary += "smoke test: $($script:smokeResult)"
if ($script:importTests.Count -gt 0) {
  $summary += 'module import tests:'
  foreach ($line in $script:importTests) { $summary += "  $line" }
}
$summary += ''
$verdict = ''
if ($sidecarCount -eq 0) {
  if ($script:smokeOk) {
    $verdict = 'The launcher starts fine in isolation (hidden smoke test), but DSH is not keeping a QuickDesk sidecar running. Most likely the plugin host module did not load/apply, so startSidecar() was never called (or its spawn failed). Check dsh-logs/ and plugin-import.txt.'
  } elseif ($script:smokeResult -like 'started*' -and $script:smokeResult -match 'exitedWithin8s=True') {
    $verdict = 'The hidden launcher smoke test exited within 8 seconds: the launcher itself fails on this machine. See launcher-smoke/result.txt, stderr.txt and launcher.log.'
  } elseif (-not $script:launcherLogFound) {
    $verdict = 'NO sidecar process and NO launcher.log. QuickDesk host side never started the sidecar on this machine. Most likely the plugin host module did not load/apply, or spawning powershell.exe failed. Check dsh-logs/ and plugin-import.txt.'
  } else {
    $verdict = 'launcher.log exists but no sidecar process is running now: the launcher ran earlier and exited. Check the last launcher.log lines and dsh-logs/.'
  }
} elseif ($sidecarCount -gt 0 -and -not $script:launcherLogFound) {
  $verdict = 'A sidecar process is running but launcher.log is missing. Check permissions and the exact log path.'
} else {
  $verdict = 'A sidecar process is running and launcher.log exists; the hotkey listener should be active. Check launcher.log for hotkey fired/input shown lines.'
}
if ($script:smokeResult -like 'started*' -and $script:smokeResult -match 'exitedWithin8s=True') {
  $verdict += ' The hidden launcher smoke test exited within 8 seconds - see launcher-smoke/result.txt and stderr.'
}
$summary += "VERDICT: $verdict"
$summary += ''
$summary += "Report zip: $zipPath"
$summary += "Temporary collection folder: $out (removed after a successful zip)"
Write-TextFile 'summary.txt' $summary

if ($script:errors.Count -gt 0) {
  Write-TextFile 'errors.txt' $script:errors
  Write-Host ''
  Write-Host 'Some sections failed; see errors.txt'
}

$zipOk = $false
$zipError = ''
$tempRemoved = $false
try {
  if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force -ErrorAction SilentlyContinue }
  Compress-Archive -Path (Join-Path $out '*') -DestinationPath $zipPath -Force -ErrorAction Stop
  $zipOk = $true
  Write-Host ''
  Write-Host "DONE. Report zip: $zipPath" -ForegroundColor Green
} catch {
  $zipError = $_.Exception.Message
  Write-Host ''
  Write-Host "Zip failed: $zipError" -ForegroundColor Yellow
  Write-Host "Temporary report folder kept for inspection: $out"
}

# Requirement: remove the temporary collection folder after the zip is written.
if ($zipOk) {
  try {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction Stop
    $tempRemoved = -not (Test-Path -LiteralPath $tempRoot)
  } catch {
    $zipError = 'Zip written, but the temporary folder could not be removed: ' + $_.Exception.Message
  }
}

$resultJson = @{
  ok = $zipOk
  canceled = $false
  zip = $zipPath
  temp = $tempRoot
  tempRemoved = $tempRemoved
  error = $zipError
} | ConvertTo-Json -Compress
Write-Output ("QUICKDESK_DIAGNOSTICS_JSON: " + $resultJson)

if (-not $zipOk) { exit 1 }
exit 0
