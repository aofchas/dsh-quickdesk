param(
    [string]$Hotkey = 'Ctrl+Alt+Space',
    [string]$StatusCorner = 'top-right',
    [string]$SubmitKey = 'Enter',
    [string]$CancelKey = 'Escape',
    # Localized copy from the host half, UTF-8 + base64 so non-ASCII survives
    # the Node -> powershell.exe command line on every code page.
    [string]$UiBrand = '',
    [string]$UiPlaceholder = '',
    [string]$UiHint = '',
    [switch]$SelfTest
)

function Decode-QuickDeskText([string]$value, [string]$fallback) {
    if ([string]::IsNullOrWhiteSpace($value)) { return $fallback }
    try { return [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($value)) } catch { return $fallback }
}

# One sidecar per machine: a second copy (for example after a plugin reload
# raced its predecessor) must not fight for the same global hotkey.
$copilotMutex = New-Object System.Threading.Mutex($false, 'Global\dsh-quickdesk-sidecar')
try {
    if (-not $copilotMutex.WaitOne(0)) { exit 0 }
} catch [System.Threading.AbandonedMutexException] {
    # Previous owner crashed; this process now owns the mutex.
}

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$source = @'
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;

namespace QuickDesk
{
    public delegate IntPtr HookProcDelegate(int nCode, IntPtr wParam, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)]
    public struct KBDLLHOOKSTRUCT
    {
        public uint vkCode;
        public uint scanCode;
        public uint flags;
        public uint time;
        public UIntPtr dwExtraInfo;
    }

    static class Native
    {
        [DllImport("user32.dll")] public static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);
        [DllImport("user32.dll")] public static extern bool UnregisterHotKey(IntPtr hWnd, int id);
        [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
        [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
        [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
        [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
        [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
        [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
        [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
        [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
        [DllImport("user32.dll")] public static extern IntPtr SetWindowsHookEx(int idHook, HookProcDelegate lpfn, IntPtr hMod, uint dwThreadId);
        [DllImport("user32.dll")] public static extern bool UnhookWindowsHookEx(IntPtr hhk);
        [DllImport("user32.dll")] public static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);
        [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vKey);
        [DllImport("kernel32.dll")] public static extern IntPtr GetModuleHandle(string lpModuleName);
    }

    struct KeyCombo
    {
        public uint Code;
        public bool Ctrl, Alt, Shift;
        public bool Valid;
    }

    static class Keys2
    {
        public static KeyCombo Parse(string text)
        {
            var combo = new KeyCombo();
            combo.Code = 0; combo.Valid = false;
            if (string.IsNullOrEmpty(text)) return combo;
            var parts = text.Split('+');
            for (int i = 0; i < parts.Length; i++)
            {
                var part = parts[i].Trim();
                if (part.Length == 0) continue;
                var lower = part.ToLowerInvariant();
                if (lower == "ctrl" || lower == "control") combo.Ctrl = true;
                else if (lower == "alt") combo.Alt = true;
                else if (lower == "shift") combo.Shift = true;
                else combo.Code = KeyCode(part);
            }
            combo.Valid = combo.Code != 0;
            return combo;
        }

        public static uint KeyCode(string text)
        {
            var value = text.Trim();
            if (value.Length == 1)
            {
                var ch = char.ToUpperInvariant(value[0]);
                if (ch >= 'A' && ch <= 'Z') return (uint)ch;
                if (ch >= '0' && ch <= '9') return (uint)ch;
            }
            var upper = value.ToUpperInvariant();
            if (upper.StartsWith("F"))
            {
                int fn;
                if (int.TryParse(upper.Substring(1), out fn) && fn >= 1 && fn <= 24) return (uint)(0x70 + fn - 1);
            }
            switch (upper)
            {
                case "SPACE": return 0x20;
                case "ENTER": case "RETURN": return 0x0D;
                case "ESC": case "ESCAPE": return 0x1B;
                case "TAB": return 0x09;
                case "BACKSPACE": return 0x08;
                case "DELETE": return 0x2E;
                case "INSERT": return 0x2D;
                case "HOME": return 0x24;
                case "END": return 0x23;
                case "PAGEUP": return 0x21;
                case "PAGEDOWN": return 0x22;
                case "UP": return 0x26;
                case "DOWN": return 0x28;
                case "LEFT": return 0x25;
                case "RIGHT": return 0x27;
            }
            return 0;
        }

        public static string Display(string text)
        {
            if (string.IsNullOrEmpty(text)) return "";
            var parts = text.Split('+');
            for (int i = 0; i < parts.Length; i++)
            {
                if (parts[i].Trim().ToLowerInvariant() == "escape") parts[i] = "Esc";
            }
            return string.Join("+", parts);
        }
    }

    public static class Program
    {
        static HiddenForm hidden;
        static InputForm input;
        static StatusForm status;

        static KeyCombo hotkeyCombo;
        static IntPtr hookHandle = IntPtr.Zero;
        static HookProcDelegate hookDelegate;
        static DateTime lastHotkeyAt = DateTime.MinValue;
        static readonly object logLock = new object();
        static string logFile;
        static int hotkeyAttempts;

        public static void Log(string line)
        {
            try
            {
                if (logFile == null)
                {
                    var dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "dsh-quickdesk");
                    Directory.CreateDirectory(dir);
                    logFile = Path.Combine(dir, "launcher.log");
                }
                lock (logLock)
                {
                    File.AppendAllText(logFile, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss.fff") + " " + line + Environment.NewLine);
                }
            }
            catch { }
        }

        static void TriggerHotkey(string source)
        {
            var now = DateTime.UtcNow;
            lock (logLock)
            {
                if ((now - lastHotkeyAt).TotalMilliseconds < 500) return;
                lastHotkeyAt = now;
            }
            hotkeyAttempts += 1;
            Log("hotkey fired via " + source + " (count=" + hotkeyAttempts + ")");
            try
            {
                hidden.BeginInvoke(new Action(delegate
                {
                    input.ShowInput();
                    Log("input shown");
                }));
            }
            catch { }
        }

        static IntPtr HookProc(int nCode, IntPtr wParam, IntPtr lParam)
        {
            try
            {
                if (nCode >= 0)
                {
                    int message = wParam.ToInt32();
                    if (message == 0x100 || message == 0x104)
                    {
                        var data = (KBDLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(KBDLLHOOKSTRUCT));
                        if ((uint)data.vkCode == hotkeyCombo.Code)
                        {
                            bool ctrl = (Native.GetAsyncKeyState(0x11) & 0x8000) != 0;
                            bool alt = (Native.GetAsyncKeyState(0x12) & 0x8000) != 0;
                            bool shift = (Native.GetAsyncKeyState(0x10) & 0x8000) != 0;
                            if (ctrl == hotkeyCombo.Ctrl && alt == hotkeyCombo.Alt && shift == hotkeyCombo.Shift)
                                TriggerHotkey("low-level hook");
                        }
                    }
                }
            }
            catch { }
            return Native.CallNextHookEx(hookHandle, nCode, wParam, lParam);
        }

        static void InstallHook()
        {
            try
            {
                hookDelegate = HookProc;
                hookHandle = Native.SetWindowsHookEx(13, hookDelegate, Native.GetModuleHandle(null), 0);
                Log("low-level hook installed=" + (hookHandle != IntPtr.Zero));
            }
            catch (Exception error)
            {
                Log("low-level hook failed: " + error.Message);
            }
        }

        public static void Run(string hotkey, string corner, string submitKey, string cancelKey, string brandText, string placeholderText, string hintText, bool selfTest)
        {
            Application.EnableVisualStyles();
            hotkeyCombo = Keys2.Parse(hotkey);
            if (!hotkeyCombo.Valid) hotkeyCombo = Keys2.Parse("Ctrl+Alt+Space");
            hidden = new HiddenForm(hotkey);
            input = new InputForm(submitKey, cancelKey, brandText, placeholderText, hintText);
            status = new StatusForm(corner);
            hidden.HotkeyPressed += delegate { TriggerHotkey("RegisterHotKey"); };
            Log("start pid=" + System.Diagnostics.Process.GetCurrentProcess().Id + " hotkey=" + hotkey);
            InstallHook();
            Application.ApplicationExit += delegate
            {
                try { if (hookHandle != IntPtr.Zero) Native.UnhookWindowsHookEx(hookHandle); } catch { }
            };
            input.Submitted += delegate(string text)
            {
                Program.Log("submit len=" + text.Length);
                Console.Out.WriteLine("submit|" + Convert.ToBase64String(Encoding.UTF8.GetBytes(text)));
                Console.Out.Flush();
            };
            hidden.EnsureHandle();
            if (selfTest)
            {
                hidden.BeginInvoke(new Action(delegate { status.ShowStatus("Done - 12 steps - 41s", 9000); }));
                var quitTimer = new System.Threading.Timer(delegate(object state)
                {
                    try { hidden.BeginInvoke(new Action(delegate { Application.Exit(); })); } catch { }
                }, null, 30000, System.Threading.Timeout.Infinite);
                GC.KeepAlive(quitTimer);
                hidden.BeginInvoke(new Action(delegate { input.ShowInput(); }));
            }
            var thread = new Thread(StdinLoop);
            thread.IsBackground = true;
            thread.Start();
            Console.Out.WriteLine("ready");
            Console.Out.Flush();
            Application.Run(new AppContext());
        }

        static void StdinLoop()
        {
            try
            {
                string line;
                while ((line = Console.In.ReadLine()) != null)
                {
                    var parts = line.Split(new[] { '|' }, 3);
                    if (parts.Length == 0) continue;
                    var command = parts[0];
                    if (command == "status" && parts.Length >= 3)
                    {
                        var text = Encoding.UTF8.GetString(Convert.FromBase64String(parts[1]));
                        int hideAfter;
                        int.TryParse(parts[2], out hideAfter);
                        hidden.BeginInvoke(new Action(delegate { status.ShowStatus(text, hideAfter); }));
                    }
                    else if (command == "hide")
                    {
                        hidden.BeginInvoke(new Action(delegate { status.Hide(); }));
                    }
                    else if (command == "show")
                    {
                        hidden.BeginInvoke(new Action(delegate { input.ShowInput(); }));
                    }
                    else if (command == "quit")
                    {
                        hidden.BeginInvoke(new Action(delegate { Application.Exit(); }));
                        return;
                    }
                }
            }
            catch { }
            // Keep running when stdin closes in a standalone test; the Host
            // plugin kills this process when its own effect is disposed.
        }
    }

    class AppContext : ApplicationContext { }

    class HiddenForm : Form
    {
        public event Action HotkeyPressed;
        readonly string spec;
        readonly int id = 0x5144;
        bool registered;

        public HiddenForm(string spec)
        {
            this.spec = spec;
            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false;
            StartPosition = FormStartPosition.Manual;
            Location = new Point(-3000, -3000);
            Size = new Size(1, 1);
            Opacity = 0;
            Visible = true;
        }

        public void EnsureHandle() { var handle = Handle; GC.KeepAlive(handle); }

        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            try
            {
                var combo = Keys2.Parse(spec);
                if (combo.Valid)
                {
                    uint modifiers = 0;
                    if (combo.Ctrl) modifiers |= 0x2;
                    if (combo.Alt) modifiers |= 0x1;
                    if (combo.Shift) modifiers |= 0x4;
                    registered = Native.RegisterHotKey(Handle, id, modifiers, combo.Code);
                }
            }
            catch { }
            if (!registered)
            {
                try { Console.Error.WriteLine("hotkey-unavailable|" + spec); Console.Error.Flush(); } catch { }
            }
            Program.Log("RegisterHotKey registered=" + registered + " spec=" + spec);
        }

        protected override void WndProc(ref Message m)
        {
            if (m.Msg == 0x0312 && (int)m.WParam == id)
            {
                var handler = HotkeyPressed;
                if (handler != null) { try { handler(); } catch { } }
                return;
            }
            base.WndProc(ref m);
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            try { if (registered) Native.UnregisterHotKey(Handle, id); } catch { }
            base.OnFormClosing(e);
        }
    }

    class InputForm : Form
    {
        public event Action<string> Submitted;
        readonly TextBox box;
        readonly Label placeholder;
        readonly Panel shell;
        readonly KeyCombo submit;
        readonly KeyCombo cancel;
        readonly System.Windows.Forms.Timer fade;
        readonly Label hint;

        public InputForm(string submitKey, string cancelKey, string brandText, string placeholderText, string hintText)
        {
            submit = Keys2.Parse(submitKey);
            if (!submit.Valid) submit = Keys2.Parse("Enter");
            cancel = Keys2.Parse(cancelKey);
            if (!cancel.Valid) cancel = Keys2.Parse("Escape");

            FormBorderStyle = FormBorderStyle.None;
            TopMost = true;
            ShowInTaskbar = false;
            StartPosition = FormStartPosition.Manual;
            ClientSize = new Size(720, 124);
            BackColor = Color.FromArgb(21, 24, 31);
            Opacity = 0.0;
            Padding = new Padding(0);

            var brand = new Label();
            brand.Text = string.IsNullOrWhiteSpace(brandText) ? "QuickDesk  -  desktop assistant" : brandText;
            brand.AutoSize = false;
            brand.Bounds = new Rectangle(26, 14, 360, 22);
            brand.ForeColor = Color.FromArgb(146, 165, 255);
            brand.BackColor = Color.Transparent;
            brand.Font = new Font("Microsoft YaHei UI", 10.5f, FontStyle.Bold);
            Controls.Add(brand);

            hint = new Label();
            hint.Text = string.IsNullOrWhiteSpace(hintText)
                ? Keys2.Display(submitKey) + " send    " + Keys2.Display(cancelKey) + " close"
                : hintText;
            hint.AutoSize = false;
            hint.TextAlign = ContentAlignment.MiddleRight;
            hint.Bounds = new Rectangle(380, 14, 314, 22);
            hint.ForeColor = Color.FromArgb(118, 124, 138);
            hint.BackColor = Color.Transparent;
            hint.Font = new Font("Microsoft YaHei UI", 9f);
            Controls.Add(hint);

            shell = new RoundedPanel();
            shell.Bounds = new Rectangle(26, 48, 668, 52);
            shell.BackColor = Color.FromArgb(30, 34, 44);
            shell.Padding = new Padding(16, 0, 16, 0);
            Controls.Add(shell);

            box = new TextBox();
            box.BorderStyle = BorderStyle.None;
            box.BackColor = Color.FromArgb(30, 34, 44);
            box.ForeColor = Color.FromArgb(236, 239, 245);
            box.Font = new Font("Microsoft YaHei UI", 13.5f);
            box.Width = 636;
            box.Top = 15;
            box.Left = 16;
            box.KeyDown += OnBoxKeyDown;
            box.Enter += delegate { UpdatePlaceholder(); shell.Invalidate(); };
            box.Leave += delegate { UpdatePlaceholder(); shell.Invalidate(); };
            box.TextChanged += delegate { UpdatePlaceholder(); };
            shell.Controls.Add(box);

            placeholder = new Label();
            placeholder.Text = string.IsNullOrWhiteSpace(placeholderText) ? "Type one sentence for the desktop assistant..." : placeholderText;
            placeholder.AutoSize = false;
            placeholder.Bounds = new Rectangle(17, 13, 620, 26);
            placeholder.ForeColor = Color.FromArgb(104, 111, 126);
            placeholder.BackColor = Color.FromArgb(30, 34, 44);
            placeholder.Font = new Font("Microsoft YaHei UI", 12.5f);
            placeholder.Click += delegate { box.Focus(); };
            shell.Controls.Add(placeholder);
            placeholder.BringToFront();
            UpdatePlaceholder();

            fade = new System.Windows.Forms.Timer();
            fade.Interval = 15;
            fade.Tick += delegate
            {
                if (Opacity >= 0.945)
                {
                    Opacity = 0.945;
                    fade.Stop();
                }
                else Opacity = Math.Min(0.945, Opacity + 0.09);
            };

            Paint += OnPaint;
            Deactivate += delegate { /* keep the draft; Enter submits, Esc closes */ };
        }

        void OnPaint(object sender, PaintEventArgs e)
        {
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            using (var path = RoundedPanel.RoundRect(new Rectangle(0, 0, Width - 1, Height - 1), 18))
            using (var pen = new Pen(Color.FromArgb(62, 96, 210), 1.6f))
                e.Graphics.DrawPath(pen, path);
            using (var brush = new LinearGradientBrush(new Rectangle(0, 0, Width, 6), Color.FromArgb(72, 120, 255), Color.FromArgb(21, 24, 31), LinearGradientMode.Horizontal))
                e.Graphics.FillRectangle(brush, 1, 1, Width - 2, 2);
        }

        void UpdatePlaceholder()
        {
            placeholder.Visible = box.Text.Length == 0;
        }

        protected override bool ShowWithoutActivation { get { return false; } }

        protected override CreateParams CreateParams
        {
            get
            {
                var cp = base.CreateParams;
                cp.ClassStyle |= 0x00020000; // CS_DROPSHADOW
                return cp;
            }
        }

        protected override void OnShown(EventArgs e)
        {
            base.OnShown(e);
            ApplyRoundRegion();
            fade.Start();
        }

        void ApplyRoundRegion()
        {
            try
            {
                using (var path = RoundedPanel.RoundRect(new Rectangle(0, 0, Width, Height), 18))
                    Region = new Region(path);
            }
            catch { }
        }

        void OnBoxKeyDown(object sender, KeyEventArgs e)
        {
            if (Matches(e, submit))
            {
                e.SuppressKeyPress = true;
                var text = box.Text.Trim();
                Hide();
                if (text.Length > 0 && Submitted != null) Submitted(text);
            }
            else if (Matches(e, cancel))
            {
                e.SuppressKeyPress = true;
                Hide();
            }
        }

        static bool Matches(KeyEventArgs e, KeyCombo combo)
        {
            if (!combo.Valid) return false;
            if (combo.Ctrl != e.Control || combo.Alt != e.Alt || combo.Shift != e.Shift) return false;
            return (uint)e.KeyCode == combo.Code || (uint)e.KeyValue == combo.Code;
        }

        public void ShowInput()
        {
            // Show Desktop / Win+D can minimize the form; a plain Show() would
            // keep it minimized and invisible. Restore it every time.
            try
            {
                if (Native.IsIconic(Handle) || WindowState == FormWindowState.Minimized)
                    WindowState = FormWindowState.Normal;
            }
            catch { }
            var wa = Screen.PrimaryScreen.WorkingArea;
            Location = new Point(wa.Left + (wa.Width - Width) / 2, wa.Bottom - Height - 96);
            box.Text = string.Empty;
            Show();
            try { Native.ShowWindow(Handle, 9); } catch { } // SW_RESTORE
            TopMost = false;
            TopMost = true;
            ForceForeground(Handle);
            box.Focus();
            UpdatePlaceholder();
            // Opacity must be re-armed on every show: after Hide(), OnShown is not
            // guaranteed to run again, so without this the form stays invisible.
            Opacity = 0.0;
            fade.Start();
            shell.Invalidate();
            Program.Log("ShowInput visible=" + Visible + " state=" + WindowState + " opacity=" + Opacity + " bounds=" + Bounds);
        }

        public static void ForceForeground(IntPtr handle)
        {
            try
            {
                var foreground = Native.GetForegroundWindow();
                uint pid;
                var foregroundThread = Native.GetWindowThreadProcessId(foreground, out pid);
                var currentThread = Native.GetCurrentThreadId();
                Native.AttachThreadInput(currentThread, foregroundThread, true);
                Native.keybd_event(0x12, 0, 0, UIntPtr.Zero);
                Native.keybd_event(0x12, 0, 2, UIntPtr.Zero);
                Native.SetForegroundWindow(handle);
                Native.BringWindowToTop(handle);
                Native.AttachThreadInput(currentThread, foregroundThread, false);
            }
            catch { }
        }
    }

    class RoundedPanel : Panel
    {
        public RoundedPanel()
        {
            SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer, true);
        }

        public static GraphicsPath RoundRect(Rectangle bounds, int radius)
        {
            int d = radius * 2;
            var path = new GraphicsPath();
            path.AddArc(bounds.X, bounds.Y, d, d, 180, 90);
            path.AddArc(bounds.Right - d, bounds.Y, d, d, 270, 90);
            path.AddArc(bounds.Right - d, bounds.Bottom - d, d, d, 0, 90);
            path.AddArc(bounds.X, bounds.Bottom - d, d, d, 90, 90);
            path.CloseFigure();
            return path;
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            using (var path = RoundRect(new Rectangle(0, 0, Width - 1, Height - 1), 14))
            using (var fill = new SolidBrush(Color.FromArgb(30, 34, 44)))
            using (var border = new Pen(ClientRectangle.Contains(PointToClient(Cursor.Position)) || ContainsFocus ? Color.FromArgb(78, 122, 235) : Color.FromArgb(48, 54, 68), 1.2f))
            {
                e.Graphics.FillPath(fill, path);
                e.Graphics.DrawPath(border, path);
            }
            base.OnPaint(e);
        }
    }

    class StatusForm : Form
    {
        readonly Label label;
        readonly System.Windows.Forms.Timer timer;
        readonly string corner;

        public StatusForm(string corner)
        {
            this.corner = string.IsNullOrEmpty(corner) ? "top-right" : corner.Trim().ToLowerInvariant();
            FormBorderStyle = FormBorderStyle.None;
            TopMost = true;
            ShowInTaskbar = false;
            StartPosition = FormStartPosition.Manual;
            ClientSize = new Size(540, 38);
            BackColor = Color.FromArgb(19, 22, 29);
            Opacity = 0.88;

            label = new Label();
            label.Dock = DockStyle.Fill;
            label.TextAlign = ContentAlignment.MiddleLeft;
            label.Padding = new Padding(16, 0, 14, 0);
            label.ForeColor = Color.FromArgb(236, 239, 245);
            label.Font = new Font("Microsoft YaHei UI", 9.5f);
            label.AutoEllipsis = true;
            label.BackColor = Color.Transparent;
            Controls.Add(label);

            timer = new System.Windows.Forms.Timer();
            timer.Tick += delegate { timer.Stop(); Hide(); };

            Paint += delegate(object s, PaintEventArgs e)
            {
                e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
                using (var path = RoundedPanel.RoundRect(new Rectangle(0, 0, Width - 1, Height - 1), 12))
                using (var fill = new SolidBrush(Color.FromArgb(19, 22, 29)))
                using (var border = new Pen(Color.FromArgb(54, 92, 190), 1f))
                {
                    e.Graphics.FillPath(fill, path);
                    e.Graphics.DrawPath(border, path);
                }
                using (var accent = new SolidBrush(Color.FromArgb(74, 118, 235)))
                    e.Graphics.FillRectangle(accent, 6, 9, 3, Height - 18);
            };
        }

        protected override bool ShowWithoutActivation { get { return true; } }

        protected override CreateParams CreateParams
        {
            get
            {
                var cp = base.CreateParams;
                cp.ClassStyle |= 0x00020000; // CS_DROPSHADOW
                cp.ExStyle |= 0x20;         // WS_EX_TRANSPARENT
                cp.ExStyle |= 0x08000000;   // WS_EX_NOACTIVATE
                cp.ExStyle |= 0x80;         // WS_EX_TOOLWINDOW
                return cp;
            }
        }

        public void ShowStatus(string text, int hideAfterMs)
        {
            if (InvokeRequired)
            {
                try { BeginInvoke(new Action(delegate { ShowStatus(text, hideAfterMs); })); } catch { }
                return;
            }
            label.Text = text ?? string.Empty;
            PositionWindow();
            try
            {
                if (Native.IsIconic(Handle) || WindowState == FormWindowState.Minimized)
                    WindowState = FormWindowState.Normal;
            }
            catch { }
            try
            {
                using (var path = RoundedPanel.RoundRect(new Rectangle(0, 0, Width, Height), 12))
                    Region = new Region(path);
            }
            catch { }
            Show();
            try { Native.ShowWindow(Handle, 9); } catch { }
            TopMost = false;
            TopMost = true;
            var delay = hideAfterMs > 0 ? hideAfterMs : 15000;
            timer.Stop();
            timer.Interval = Math.Max(1000, delay);
            timer.Start();
        }

        void PositionWindow()
        {
            var wa = Screen.PrimaryScreen.WorkingArea;
            int margin = 20;
            int x, y;
            if (corner.EndsWith("left")) x = wa.Left + margin; else x = wa.Right - Width - margin;
            if (corner.StartsWith("bottom")) y = wa.Bottom - Height - margin; else y = wa.Top + margin;
            Location = new Point(x, y);
        }
    }
}
'@

Add-Type -TypeDefinition $source -ReferencedAssemblies System.Windows.Forms, System.Drawing, System.Core
$brandText = Decode-QuickDeskText $UiBrand 'QuickDesk  -  desktop assistant'
$placeholderText = Decode-QuickDeskText $UiPlaceholder 'Type one sentence for the desktop assistant...'
$hintText = Decode-QuickDeskText $UiHint ("$SubmitKey send    $CancelKey close")
[QuickDesk.Program]::Run($Hotkey, $StatusCorner, $SubmitKey, $CancelKey, $brandText, $placeholderText, $hintText, [bool]$SelfTest)
