param(
    [Parameter(Mandatory = $true)][string]$Payload
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

Add-Type -Namespace QuickDeskNative -Name Win -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
[DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
[DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
[DllImport("user32.dll")] public static extern void keybd_event(byte virtualKey, byte scanCode, uint flags, UIntPtr extraInfo);
[DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
'@

$json = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Payload))
$request = $json | ConvertFrom-Json
$strings = $request.strings

# Localized copy supplied by the host half; Chinese fallbacks keep an older
# host (or a stripped install) working.
function Get-QuickDeskText([string]$name, [string]$fallback) {
    if ($null -eq $strings) { return $fallback }
    $entry = $strings.PSObject.Properties[$name]
    if ($null -ne $entry -and -not [string]::IsNullOrWhiteSpace([string]$entry.Value)) { return [string]$entry.Value }
    return $fallback
}

$timeoutMs = 120000
if ($null -ne $request.timeoutMs -and [int]$request.timeoutMs -gt 0) { $timeoutMs = [int]$request.timeoutMs }
$approveKey = if ($request.approveKey) { [string]$request.approveKey } else { 'Enter' }
$rejectKey = if ($request.rejectKey) { [string]$request.rejectKey } else { 'Backspace' }

$script:keyNames = @{
    'ENTER' = 13; 'RETURN' = 13; 'ESC' = 27; 'ESCAPE' = 27; 'SPACE' = 32; 'TAB' = 9;
    'BACKSPACE' = 8; 'BACK' = 8; 'DELETE' = 46; 'INSERT' = 45; 'HOME' = 36; 'END' = 35;
    'PAGEUP' = 33; 'PAGEDOWN' = 34; 'UP' = 38; 'DOWN' = 40; 'LEFT' = 37; 'RIGHT' = 39;
    'A' = 65; 'B' = 66; 'C' = 67; 'D' = 68; 'E' = 69; 'F' = 70; 'G' = 71; 'H' = 72; 'I' = 73;
    'J' = 74; 'K' = 75; 'L' = 76; 'M' = 77; 'N' = 78; 'O' = 79; 'P' = 80; 'Q' = 81; 'R' = 82;
    'S' = 83; 'T' = 84; 'U' = 85; 'V' = 86; 'W' = 87; 'X' = 88; 'Y' = 89; 'Z' = 90;
    '0' = 48; '1' = 49; '2' = 50; '3' = 51; '4' = 52; '5' = 53; '6' = 54; '7' = 55; '8' = 56; '9' = 57
}
for ($i = 1; $i -le 24; $i++) { $script:keyNames["F$i"] = 111 + $i }

function ConvertTo-KeyBinding([string]$text) {
    $binding = @{ Code = 0; Ctrl = $false; Alt = $false; Shift = $false; Valid = $false }
    if ([string]::IsNullOrWhiteSpace($text)) { return $binding }
    foreach ($part in ($text -split '\+')) {
        $piece = $part.Trim()
        if (-not $piece) { continue }
        $upper = $piece.ToUpperInvariant()
        if ($upper -in @('CTRL', 'CONTROL')) { $binding.Ctrl = $true }
        elseif ($upper -eq 'ALT') { $binding.Alt = $true }
        elseif ($upper -eq 'SHIFT') { $binding.Shift = $true }
        else {
            if ($script:keyNames.ContainsKey($upper)) { $binding.Code = [int]$script:keyNames[$upper] }
            else { $binding.Valid = $false; return $binding }
        }
    }
    $binding.Valid = $binding.Code -ne 0
    return $binding
}

$approve = ConvertTo-KeyBinding $approveKey
if (-not $approve.Valid) { $approve = ConvertTo-KeyBinding 'Enter' }
$reject = ConvertTo-KeyBinding $rejectKey
if (-not $reject.Valid) { $reject = ConvertTo-KeyBinding 'Backspace' }

function Format-KeyLabel([string]$text) {
    if ([string]::IsNullOrWhiteSpace($text)) { return '' }
    $parts = $text -split '\+'
    for ($i = 0; $i -lt $parts.Count; $i++) {
        if ($parts[$i].Trim().ToUpperInvariant() -eq 'ESCAPE') { $parts[$i] = 'Esc' }
    }
    return ($parts -join '+')
}

$script:decision = 'deny'

function New-RoundedPath([System.Drawing.Rectangle]$bounds, [int]$radius) {
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = $radius * 2
    $path.AddArc($bounds.X, $bounds.Y, $d, $d, 180, 90)
    $path.AddArc($bounds.Right - $d, $bounds.Y, $d, $d, 270, 90)
    $path.AddArc($bounds.Right - $d, $bounds.Bottom - $d, $d, $d, 0, 90)
    $path.AddArc($bounds.X, $bounds.Bottom - $d, $d, $d, 90, 90)
    $path.CloseFigure()
    return $path
}

$script:form = New-Object System.Windows.Forms.Form
$script:form.Text = Get-QuickDeskText 'formTitle' 'QuickDesk 审批'
$script:form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
$script:form.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
$script:form.TopMost = $true
$script:form.ShowInTaskbar = $false
$script:form.BackColor = [System.Drawing.Color]::FromArgb(20, 23, 30)
$script:form.ForeColor = [System.Drawing.Color]::White
$script:form.ClientSize = New-Object System.Drawing.Size(500, 262)
$script:form.Opacity = 0.0

$script:title = New-Object System.Windows.Forms.Label
$script:title.AutoSize = $false
$script:title.Bounds = New-Object System.Drawing.Rectangle(24, 18, 452, 30)
$script:title.Text = Get-QuickDeskText 'title' 'QuickDesk · 需要你审批'
$script:title.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 13.5, [System.Drawing.FontStyle]::Bold)
$script:title.ForeColor = [System.Drawing.Color]::FromArgb(236, 239, 245)
$script:title.BackColor = [System.Drawing.Color]::Transparent

$script:tool = New-Object System.Windows.Forms.Label
$script:tool.AutoSize = $false
$script:tool.Bounds = New-Object System.Drawing.Rectangle(24, 54, 452, 24)
$script:tool.Text = [string]$request.toolName
$script:tool.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 10.5)
$script:tool.ForeColor = [System.Drawing.Color]::FromArgb(122, 170, 255)
$script:tool.BackColor = [System.Drawing.Color]::Transparent

$script:reason = New-Object System.Windows.Forms.Label
$script:reason.AutoSize = $false
$script:reason.Bounds = New-Object System.Drawing.Rectangle(24, 84, 452, 86)
$script:reason.Text = [string]$request.display
$script:reason.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 9.5)
$script:reason.ForeColor = [System.Drawing.Color]::FromArgb(216, 218, 224)
$script:reason.BackColor = [System.Drawing.Color]::Transparent
$script:reason.AutoEllipsis = $true

$script:hint = New-Object System.Windows.Forms.Label
$script:hint.AutoSize = $false
$script:hint.Bounds = New-Object System.Drawing.Rectangle(24, 178, 452, 22)
$script:hint.Text = Get-QuickDeskText 'hint' "$(Format-KeyLabel $approveKey) 通过    $(Format-KeyLabel $rejectKey) 拒绝    超时自动拒绝"
$script:hint.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 9)
$script:hint.ForeColor = [System.Drawing.Color]::FromArgb(140, 146, 158)
$script:hint.BackColor = [System.Drawing.Color]::Transparent

$script:approveButton = New-Object System.Windows.Forms.Button
$script:approveButton.Bounds = New-Object System.Drawing.Rectangle(24, 208, 214, 36)
$script:approveButton.Text = Get-QuickDeskText 'approve' "通过  ($(Format-KeyLabel $approveKey))"
$script:approveButton.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$script:approveButton.FlatAppearance.BorderSize = 1
$script:approveButton.FlatAppearance.BorderColor = [System.Drawing.Color]::FromArgb(60, 130, 100)
$script:approveButton.BackColor = [System.Drawing.Color]::FromArgb(30, 52, 44)
$script:approveButton.ForeColor = [System.Drawing.Color]::FromArgb(200, 245, 220)
$script:approveButton.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 9.5, [System.Drawing.FontStyle]::Bold)

$script:rejectButton = New-Object System.Windows.Forms.Button
$script:rejectButton.Bounds = New-Object System.Drawing.Rectangle(262, 208, 214, 36)
$script:rejectButton.Text = Get-QuickDeskText 'reject' "拒绝  ($(Format-KeyLabel $rejectKey))"
$script:rejectButton.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$script:rejectButton.FlatAppearance.BorderSize = 1
$script:rejectButton.FlatAppearance.BorderColor = [System.Drawing.Color]::FromArgb(130, 70, 80)
$script:rejectButton.BackColor = [System.Drawing.Color]::FromArgb(52, 32, 36)
$script:rejectButton.ForeColor = [System.Drawing.Color]::FromArgb(250, 212, 216)
$script:rejectButton.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 9.5, [System.Drawing.FontStyle]::Bold)

$script:form.Controls.AddRange(@($script:title, $script:tool, $script:reason, $script:hint, $script:approveButton, $script:rejectButton))
$script:form.KeyPreview = $true

function Test-KeyBinding($e, $binding) {
    if (-not $binding.Valid) { return $false }
    if ([bool]$binding.Ctrl -ne $e.Control) { return $false }
    if ([bool]$binding.Alt -ne $e.Alt) { return $false }
    if ([bool]$binding.Shift -ne $e.Shift) { return $false }
    return ($e.KeyValue -eq [int]$binding.Code)
}

$script:form.Add_KeyDown({
    param($sender, $e)
    if (Test-KeyBinding $e $approve) {
        $script:decision = 'allow'; $e.SuppressKeyPress = $true; $script:form.Close()
    }
    elseif (Test-KeyBinding $e $reject) {
        $script:decision = 'deny'; $e.SuppressKeyPress = $true; $script:form.Close()
    }
})
$script:approveButton.Add_Click({ $script:decision = 'allow'; $script:form.Close() })
$script:rejectButton.Add_Click({ $script:decision = 'deny'; $script:form.Close() })

$script:timer = New-Object System.Windows.Forms.Timer
$script:timer.Interval = $timeoutMs
$script:timer.Add_Tick({ $script:decision = 'timeout'; $script:timer.Stop(); $script:form.Close() })

$script:fade = New-Object System.Windows.Forms.Timer
$script:fade.Interval = 15
$script:fade.Add_Tick({
    if ($script:form.Opacity -ge 0.96) { $script:form.Opacity = 0.96; $script:fade.Stop() }
    else { $script:form.Opacity = [Math]::Min(0.96, $script:form.Opacity + 0.1) }
})

$script:form.Add_Shown({
    $work = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
    $path = New-RoundedPath (New-Object System.Drawing.Rectangle(0, 0, $script:form.Width, $script:form.Height)) 18
    $script:form.Region = New-Object System.Drawing.Region($path)
    $script:form.Location = New-Object System.Drawing.Point(($work.Right - $script:form.Width - 24), ($work.Bottom - $script:form.Height - 24))
    $script:form.Visible = $true

    $foreground = [QuickDeskNative.Win]::GetForegroundWindow()
    [uint32]$foregroundPid = 0
    $foregroundThread = [QuickDeskNative.Win]::GetWindowThreadProcessId($foreground, [ref]$foregroundPid)
    $currentThread = [QuickDeskNative.Win]::GetCurrentThreadId()
    [void][QuickDeskNative.Win]::AttachThreadInput($currentThread, $foregroundThread, $true)
    [QuickDeskNative.Win]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)
    [QuickDeskNative.Win]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
    [void][QuickDeskNative.Win]::SetForegroundWindow($script:form.Handle)
    [void][QuickDeskNative.Win]::BringWindowToTop($script:form.Handle)
    [void][QuickDeskNative.Win]::AttachThreadInput($currentThread, $foregroundThread, $false)
    $script:form.Activate()
    $script:form.Focus()
    $script:fade.Start()
    $script:timer.Start()
})

[void]$script:form.ShowDialog()
$script:timer.Stop()
$script:fade.Stop()

@{ decision = $script:decision } | ConvertTo-Json -Compress | Write-Output
