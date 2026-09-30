<#
  MotionWorks Use - COM bridge (32-bit Windows PowerShell).

  WHY THIS PROCESS EXISTS
  -----------------------
  MotionWorks IEC 3 Pro registers an out-of-process COM automation server:
      Ade.Application.550  ->  LocalServer32 = <install>\Mwt.exe
  It can ONLY be instantiated from a 32-bit client, and on this machine the
  DSH agent sandbox blocks that activation (CO_E_SERVER_EXEC_FAILURE 0x80080005).
  Launched from outside the sandbox, the same call succeeds and reports
  Version 1.19 with a clean IsProjectOpen.

  So the agent does not click the IDE at all: it asks this bridge, which talks to
  the IDE through the IDE's own automation API. No synthetic input is involved,
  which is why neither the sandbox nor wincomputer's DRY_RUN gate matters here.

  PROTOCOL
  --------
  The agent writes  bridge\req.json   {"id":<n>,"verb":"...", ...}
  The bridge writes bridge\res.json   {"id":<n>,"ok":bool,"verb":...,"data":...,"error":...}
  and deletes req.json. Matching on `id` prevents reading a stale answer.

  SAFETY (non-negotiable)
  -----------------------
  * Never downloads to a controller. Never commands motion. No such verb exists.
  * `open` only accepts a project that lives under -StageRoot (a copy under the
    agent workspace), never the real project tree.
  * Never calls Quit: the user's IDE is left exactly as it was found.
#>
param(
    [string]$BridgeDir = $PSScriptRoot,
    # Defaults to the plugin's OWN stage directory, so `open` can only ever touch a
    # copy that lives beside this bridge. Never point this at a real project tree.
    [string]$StageRoot = '',
    [int]$PollMs = 250
)

$ErrorActionPreference = 'Continue'
if ([string]::IsNullOrWhiteSpace($StageRoot)) {
    $StageRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\stage'))
}
$reqPath = Join-Path $BridgeDir 'req.json'
$resPath = Join-Path $BridgeDir 'res.json'
$logPath = Join-Path $BridgeDir 'bridge.log'

function Log([string]$m) {
    $line = "{0:HH:mm:ss.fff} {1}" -f (Get-Date), $m
    Add-Content -Path $logPath -Value $line -Encoding UTF8
}

# --- single instance --------------------------------------------------------
#
# TWO bridges polling one req.json is a race, and it bit hard: the plugin spawns a
# bridge when it believes none is running, but a bridge stuck inside a slow verb
# looks dead, so a second one starts. Both then poll the same file, one consumes a
# request and (being slow) never answers it, and the caller times out with its work
# already taken from the queue. Symptom: "timed out waiting for the bridge" with no
# matching request in the log at all.
#
# The lock records the owning pid. A live owner means this process must exit rather
# than compete; a dead owner leaves a stale lock that is simply taken over.
$lockPath = Join-Path $BridgeDir 'bridge.lock'
$lockOwner = 0
if (Test-Path $lockPath) {
    try { $lockOwner = [int]((Get-Content -Path $lockPath -Raw -ErrorAction Stop).Trim()) } catch { $lockOwner = 0 }
}
if ($lockOwner -gt 0) {
    $alive = $null -ne (Get-Process -Id $lockOwner -ErrorAction SilentlyContinue)
    if ($alive) {
        Log "another bridge is already running (pid $lockOwner); exiting instead of competing for the queue"
        exit 0
    }
    Log "stale bridge lock from pid $lockOwner; taking over"
}
Set-Content -Path $lockPath -Value $PID -Encoding ASCII

function Remove-BridgeLock {
    try {
        if (Test-Path $lockPath) {
            $cur = (Get-Content -Path $lockPath -Raw -ErrorAction SilentlyContinue)
            if ($null -ne $cur -and $cur.Trim() -eq "$PID") { Remove-Item -Path $lockPath -Force -ErrorAction SilentlyContinue }
        }
    } catch { }
}

function Write-Result($id, [string]$verb, $ok, $data, [string]$err) {
    $payload = [ordered]@{
        id    = $id
        verb  = $verb
        ok    = [bool]$ok
        data  = $data
        error = $err
        pid   = $PID
        bits  = ([IntPtr]::Size * 8)
        ts    = (Get-Date).ToString('o')
    }
    # Write to a temp name then move, so a reader never sees a half-written file.
    #
    # `Set-Content -Encoding UTF8` is NOT used: in Windows PowerShell 5.1 that
    # means UTF-8 WITH a BOM, and JSON.parse in the Node half throws on the
    # leading U+FEFF. The bridge would answer in 6ms and the plugin would still
    # time out - a very expensive bug to find. WriteAllText with an explicit
    # no-BOM UTF8Encoding keeps the bytes clean for a JS reader.
    $tmp = "$resPath.tmp"
    $json = $payload | ConvertTo-Json -Depth 8
    [IO.File]::WriteAllText($tmp, $json, (New-Object Text.UTF8Encoding($false)))
    Move-Item -Force $tmp $resPath
}

# --- IDE presence guard: only ever touch an IDE that is ALREADY running. ---
Add-Type -TypeDefinition @'
using System; using System.Text; using System.Runtime.InteropServices;
public class MWW {
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr parent, EnumWindowsProc cb, IntPtr l);
  public delegate bool EnumWindowsProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetClassNameW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);

  // Licence-dialog dismissal helpers. The unlicensed build shows a modal
  // WindowsForms dialog before the IDE has any window of its own.
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr SetFocus(IntPtr h);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern IntPtr SetActiveWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool f);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();

  // Capture a window's OWN content into a DC, even when it is occluded.
  // CopyFromScreen grabs a screen REGION, so a window stacked over the IDE is
  // what you actually get in the PNG - which is how a screenshot of the IDE
  // came back showing an unrelated window. PW_RENDERFULLCONTENT (0x2) asks the
  // window to render itself instead.
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hwnd, IntPtr hdcBlt, uint nFlags);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);

  // Read the Message Window's lists as TEXT.
  //
  // The compiler's messages live in a SysListView32, and a screenshot is useless to
  // an agent that has to act on them - it cannot turn a PNG into a fix. MSAA exposes
  // the rows through IAccessible and accName(i) returns each row verbatim, so the
  // exact compiler text comes back. AccessibleChildren with an [Out] object[] fails
  // from PowerShell with E_INVALIDARG (0x80070057), so children are read by index.
  [DllImport("oleacc.dll")] public static extern int AccessibleObjectFromWindow(IntPtr hwnd, uint id, ref Guid iid, [MarshalAs(UnmanagedType.IUnknown)] out object ppv);
  [DllImport("user32.dll", EntryPoint="SendMessageW")] public static extern IntPtr SendMessagePtr(IntPtr h, uint m, IntPtr w, IntPtr l);

  public static object GetAccessible(IntPtr hwnd) {
    try {
      Guid iid = new Guid("618736E0-3C3D-11CF-810C-00AA00389B71");   // IAccessible
      object acc;
      int hr = AccessibleObjectFromWindow(hwnd, 0xFFFFFFFC, ref iid, out acc);
      return hr == 0 ? acc : null;
    } catch { return null; }
  }
  // LVM_GETITEMCOUNT = 0x1004
  public static int ListRowCount(IntPtr h) { return (int)SendMessagePtr(h, 0x1004, IntPtr.Zero, IntPtr.Zero); }

  // Modal-dialog inspection. MotionWorks asks questions in standard Win32 #32770
  // dialogs, whose text and buttons are readable through WM_GETTEXT/GetDlgCtrlID.
  // While one is up the frame window is DISABLED, and the COM API simply reports
  // nothing - which is how an agent concludes "no project" or "IDE closed" when
  // the IDE is really waiting for a button press.
  [DllImport("user32.dll")] public static extern bool IsWindowEnabled(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetDlgCtrlID(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetParent(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint cmd);
  [DllImport("user32.dll", EntryPoint="SendMessageW", CharSet=CharSet.Unicode)]
  public static extern IntPtr SendStr(IntPtr h, uint msg, IntPtr wp, StringBuilder lp);
  [DllImport("user32.dll", EntryPoint="SendMessageW", CharSet=CharSet.Unicode)]
  public static extern IntPtr SendInt(IntPtr h, uint msg, IntPtr wp, IntPtr lp);

  // Read a control's text across process boundaries. GetWindowTextW returns
  // nothing for another process's controls; WM_GETTEXT does not have that limit.
  //
  // SendMessageTimeout, NOT SendMessage: SendMessage is synchronous and blocks
  // FOREVER if the target is not pumping messages - which is exactly the state a
  // modal MotionWorks dialog leaves it in. That hung the whole bridge for five
  // minutes on a start_ide call, because the failure path inspects dialogs.
  // SMTO_ABORTIFHUNG (0x2) plus a short timeout makes inspection always safe.
  [DllImport("user32.dll", SetLastError=true, EntryPoint="SendMessageTimeoutW", CharSet=CharSet.Unicode)]
  public static extern IntPtr SendTimeoutStr(IntPtr h, uint msg, IntPtr wp, StringBuilder lp, uint flags, uint ms, out IntPtr result);
  [DllImport("user32.dll", SetLastError=true, EntryPoint="SendMessageTimeoutW", CharSet=CharSet.Unicode)]
  public static extern IntPtr SendTimeoutInt(IntPtr h, uint msg, IntPtr wp, IntPtr lp, uint flags, uint ms, out IntPtr result);

  const uint SMTO_ABORTIFHUNG = 0x0002;
  const uint TEXT_TIMEOUT_MS = 200;

  public static string ReadText(IntPtr h) { return ReadTextMs(h, TEXT_TIMEOUT_MS); }

  public static string ReadTextMs(IntPtr h, uint ms) {
    IntPtr result;
    IntPtr sent = SendTimeoutInt(h, 0x000E, IntPtr.Zero, IntPtr.Zero, SMTO_ABORTIFHUNG, ms, out result);  // WM_GETTEXTLENGTH
    if (sent == IntPtr.Zero) return "";                       // hung or gone: no text
    int n = result.ToInt32();
    if (n <= 0) return "";
    if (n > 65536) n = 65536;
    StringBuilder sb = new StringBuilder(n + 2);
    sent = SendTimeoutStr(h, 0x000D, (IntPtr)(n + 1), sb, SMTO_ABORTIFHUNG, ms, out result);              // WM_GETTEXT
    if (sent == IntPtr.Zero) return "";
    return sb.ToString();
  }

  // Press a button without risking a permanent block. BM_CLICK is synchronous
  // like any SendMessage, so it is sent with a timeout and allowed to fail.
  public static bool ClickButton(IntPtr h) {
    IntPtr result;
    IntPtr sent = SendTimeoutInt(h, 0x00F5, IntPtr.Zero, IntPtr.Zero, SMTO_ABORTIFHUNG, CLICK_TIMEOUT_MS, out result);
    if (sent != IntPtr.Zero) return true;
    // A hung dialog will not take BM_CLICK; posting is asynchronous and at least
    // queues the click for whenever the dialog next pumps.
    return PostMessage(h, 0x00F5, IntPtr.Zero, IntPtr.Zero);
  }

  const uint CLICK_TIMEOUT_MS = 2500;
}
'@

function Get-IdeWindow {
    # NOTE: the callback runs in a child scope, so the result must be stashed in
    # the SCRIPT scope. Assigning to a function-local inside the delegate and
    # returning it here silently always returns $null - that bug made the bridge
    # report "no running IDE" while the IDE was plainly on screen.
    #
    # Match on a PREFIX, not equality: once a project is open the caption becomes
    # "MotionWorks IEC 3 Pro - <project>", so an exact match stops finding the IDE
    # at the exact moment the IDE becomes useful.
    #
    # AND accept "MULTIPROG - <project>": MotionWorks IEC is an OEM build of
    # MULTIPROG, and when Mwt.exe is launched directly (which is exactly what
    # automation does) it titles itself MULTIPROG, not "MotionWorks IEC 3 Pro".
    # Matching only the latter made the bridge blind to an IDE it had just started.
    #
    # Then pick the LARGEST match. Startup creates small auxiliary windows that also
    # carry these captions, and returning one of those produced a 426x166 "IDE
    # screenshot" instead of the 1936x1048 frame.
    $script:cands = @()
    $cb = [MWW+EnumWindowsProc]{
        param($h, $l)
        if ([MWW]::IsWindowVisible($h)) {
            # ReadText, not GetWindowTextW. The latter sends WM_GETTEXT and waits
            # forever on a window that is not pumping, which made the first
            # ide_state of a session time out while some other app was hung.
            $t = [MWW]::ReadTextMs($h, 50)
            if ($t -like 'MotionWorks IEC 3 Pro*' -or $t -like 'MULTIPROG*') {
                $rc = New-Object MWW+RECT
                $area = 0
                if ([MWW]::GetWindowRect($h, [ref]$rc)) {
                    $area = [int64]($rc.Right - $rc.Left) * [int64]($rc.Bottom - $rc.Top)
                }
                $script:cands += [pscustomobject]@{ h = $h; area = $area; title = $t }
            }
        }
        return $true
    }
    [void][MWW]::EnumWindows($cb, [IntPtr]::Zero)
    if ($script:cands.Count -eq 0) { return $null }
    return ($script:cands | Sort-Object -Property area -Descending | Select-Object -First 1).h
}

# --- licence / trial dialog -------------------------------------------------
#
# The UNLICENSED build shows a modal licence dialog BEFORE the IDE creates any
# window of its own. It is a .NET WinForms window owned by mwctVerify.exe, titled
# "Motionworks IEC" (lower-case w), with children "Use Trial", "Activate Online",
# "Activate by Phone", "Find Distributor".
#
# Two consequences the bridge must handle:
#   1. Get-IdeWindow does NOT see it (wrong owner, wrong class, no "3 Pro"), so a
#      launcher that only waits for the IDE window sits there until it times out
#      while a dialog is actually waiting for a human click.
#   2. Until it is answered, the IDE has no project services and OpenProject fails
#      with "Internal error in 'OpenProject'".
function Get-TrialDialog {
    $script:trialDlg = $null
    $script:trialBtn = $null
    $cb = [MWW+EnumWindowsProc]{
        param($h, $l)
        if ([MWW]::IsWindowVisible($h)) {
            $cls = New-Object System.Text.StringBuilder 256
            [void][MWW]::GetClassNameW($h, $cls, 256)
            if ($cls.ToString() -like 'WindowsForms10.Window*') {
                $script:trialDlg = $h
                $cb2 = [MWW+EnumWindowsProc]{
                    param($k, $l2)
                    if ([MWW]::ReadText($k) -eq 'Use Trial') { $script:trialBtn = $k }
                    return $true
                }
                [void][MWW]::EnumChildWindows($h, $cb2, [IntPtr]::Zero)
            }
        }
        return $true
    }
    [void][MWW]::EnumWindows($cb, [IntPtr]::Zero)
    return @($script:trialDlg, $script:trialBtn)
}

function Invoke-TrialClick([IntPtr]$target, [IntPtr]$dialog) {
    # Attach our input thread to the dialog's threads and foreground it first.
    # Without this the synthetic click is ignored: measured, BM_CLICK and the
    # mouse messages are accepted and do nothing while the dialog is not active.
    $pidT = [uint32]0; $tid = [MWW]::GetWindowThreadProcessId($target, [ref]$pidT)
    $pidD = [uint32]0; $tidD = [MWW]::GetWindowThreadProcessId($dialog, [ref]$pidD)
    $me = [MWW]::GetCurrentThreadId()
    try {
        [void][MWW]::AttachThreadInput($me, $tid, $true)
        [void][MWW]::AttachThreadInput($me, $tidD, $true)
    } catch { }
    [void][MWW]::ShowWindow($dialog, 5)
    [void][MWW]::BringWindowToTop($dialog)
    [void][MWW]::SetForegroundWindow($dialog)
    [void][MWW]::SetActiveWindow($dialog)
    [void][MWW]::SetFocus($target)
    Start-Sleep -Milliseconds 700
}

function Test-TrialGone([IntPtr]$dialog, [int]$seconds = 20) {
    for ($i = 0; $i -lt ($seconds / 2); $i++) {
        Start-Sleep -Seconds 2
        if (-not [MWW]::IsWindow($dialog)) { return [int](($i * 2) + 2) }
    }
    return 0
}

# --- modal dialogs: the state the COM API cannot see ------------------------
#
# MotionWorks asks its questions in standard Win32 #32770 dialogs. While one is
# up the frame window is DISABLED and the automation API simply goes quiet:
# IsProjectOpen() reports false or throws, OpenProject fails, and an agent that
# trusts COM alone concludes "no project open" or "the IDE has closed" while the
# IDE is really sitting there waiting for a button press.
#
# These are plain Win32 dialogs, so their text and buttons are EXACTLY readable
# through WM_GETTEXT + GetDlgCtrlID - no OCR approximation needed. The screenshot
# remains the backstop for owner-drawn or foreign dialogs (the .NET licence
# dialog), where text extraction returns nothing.
$script:dialogHwnds = @{}

function Get-IdePid {
    $w = Get-IdeWindow
    if (-not $w) { return 0 }
    $p = [uint32]0
    [void][MWW]::GetWindowThreadProcessId([IntPtr]$w, [ref]$p)
    return [int]$p
}

function Get-IdeDialogs {
    $idePid = Get-IdePid
    $script:dialogHwnds = @{}
    $found = New-Object System.Collections.ArrayList
    if ($idePid -eq 0) { return $found }

    $cb = [MWW+EnumWindowsProc]{
        param($h, $l)
        if (-not [MWW]::IsWindowVisible($h)) { return $true }
        $p = [uint32]0; [void][MWW]::GetWindowThreadProcessId($h, [ref]$p)
        if ([int]$p -ne $script:wantPid) { return $true }
        $cls = New-Object System.Text.StringBuilder 64
        [void][MWW]::GetClassNameW($h, $cls, 64)
        if ($cls.ToString() -ne '#32770') { return $true }

        $buttons = New-Object System.Collections.ArrayList
        $texts = New-Object System.Collections.ArrayList
        $title = [MWW]::ReadText($h)
        $hex = "0x{0:X}" -f ([int64]$h)
        $script:dialogHwnds[$hex] = $h
        $script:curDlgHex = $hex

        $cb2 = [MWW+EnumWindowsProc]{
            param($k, $l2)
            if (-not [MWW]::IsWindowVisible($k)) { return $true }
            $c = New-Object System.Text.StringBuilder 64
            [void][MWW]::GetClassNameW($k, $c, 64)
            $cn = $c.ToString()
            # Only these two classes carry the question and its answers, and the class
            # is checked BEFORE reading text on purpose: every cross-process read can
            # wait out its full timeout while the IDE is busy loading a project, so
            # reading text for controls we do not care about made one inspection pass
            # take seconds and hung the whole open call.
            if ($cn -ne 'Button' -and $cn -ne 'Static') { return $true }
            $txt = [MWW]::ReadText($k)
            if (-not $txt) { return $true }
            if ($cn -eq 'Button') {
                $bid = [MWW]::GetDlgCtrlID($k)
                # The handle is needed to press it, and an IntPtr is not JSON, so it
                # travels in a side map keyed by dialog|id rather than in the result.
                $script:dialogButtons["$script:curDlgHex|$bid"] = $k
                [void]$buttons.Add([ordered]@{
                    id    = $bid
                    label = ($txt -replace '&', '').Trim()
                })
            } elseif ($cn -eq 'Static' -and $txt.Trim()) {
                [void]$texts.Add($txt.Trim())
            }
            return $true
        }
        [void][MWW]::EnumChildWindows($h, $cb2, [IntPtr]::Zero)

        [void]$found.Add([ordered]@{
            handle  = $hex
            title   = $title
            message = (($texts | Select-Object -Unique) -join "`n")
            buttons = $buttons
            enabled = [MWW]::IsWindowEnabled($h)
        })
        return $true
    }
    $script:wantPid = $idePid
    $script:dialogButtons = @{}
    [void][MWW]::EnumWindows($cb, [IntPtr]::Zero)
    return $found
}

# One screen of truth about the IDE, suitable for a tool result.
function Get-IdeState {
    $w = Get-IdeWindow
    $dialogs = Get-IdeDialogs
    $blocked = $false
    $enabled = $null
    if ($w) {
        $enabled = [MWW]::IsWindowEnabled([IntPtr]$w)
        $blocked = (-not $enabled) -or ($dialogs.Count -gt 0)
    }
    $t = ''
    if ($w) {
        $t = [MWW]::ReadText([IntPtr]$w)
    }
    return [ordered]@{
        ide_running  = [bool]$w
        ide_window   = $(if ($w) { "0x{0:X}" -f ([int64]$w) } else { $null })
        window_title = $t
        ide_enabled  = $enabled
        blocked      = $blocked
        dialog_count = $dialogs.Count
        dialogs      = @($dialogs)
        hint         = $(if ($blocked) {
            'A modal dialog is blocking the IDE. The automation API returns nothing while it is up, so "no project" / "IDE closed" MUST NOT be concluded. Answer it with answer_dialog.'
        } else { $null })
    }
}

# Prompts MotionWorks raises on open that have one obviously-safe answer. Each is
# a recoverable question about loading a COPY in the staging area, so stopping to
# ask a human for every one of them is what made opening a project look broken.
# Anything not in this table is left strictly alone and reported, so the agent
# decides rather than the bridge guessing.
$script:knownAnswers = @(
    @{ match = 'defragment';                        button = 'No'  }
    @{ match = 'would you like to load the project anyway'; button = 'Yes' }
    @{ match = 'currently loaded by';               button = 'Yes' }
    @{ match = 'abnormal termination';              button = 'Yes' }
    @{ match = 'disabled/enabled by software key';  button = 'OK'  }
)

function Resolve-KnownDialogs {
    # ONE enumeration, answering everything that matches. An earlier version looped
    # up to six passes internally, and each pass re-enumerated and re-read every
    # dialog - so a single call could cost tens of seconds while the IDE was busy
    # loading (every cross-process read waits out its timeout), which is what made
    # an open call run for minutes. Callers repeat, so one pass is enough.
    #
    # Inspection is also globally budgeted: past $script:dialogBudget the IDE is
    # plainly too busy to interrogate, and spending more of the call's deadline on
    # it guarantees a timeout instead of an answer.
    if ($null -eq $script:dialogSpent) { $script:dialogSpent = 0.0 }
    if ($script:dialogSpent -gt 25.0) { return @() }
    $swD = [Diagnostics.Stopwatch]::StartNew()
    try {
        $answered = New-Object System.Collections.ArrayList
        $dialogs = @(Get-IdeDialogs)
        if ($dialogs.Count -eq 0) { return $answered }
        foreach ($d in $dialogs) {
            $hay = ("$($d.title)`n$($d.message)").ToLower()
            foreach ($k in $script:knownAnswers) {
                if ($hay -notlike "*$($k.match)*") { continue }
                $btn = $d.buttons | Where-Object { $_.label -ieq $k.button } | Select-Object -First 1
                if ($btn) {
                    $bh = $script:dialogButtons["$($d.handle)|$($btn.id)"]
                    if ($bh -and [MWW]::ClickButton([IntPtr]$bh)) {
                        [void]$answered.Add([ordered]@{
                            dialog  = $d.handle
                            matched = $k.match
                            pressed = $btn.label
                            message = $d.message
                        })
                    }
                }
                break
            }
        }
        if ($answered.Count -gt 0) { Start-Sleep -Milliseconds 700 }
        return $answered
    } finally {
        $swD.Stop()
        $script:dialogSpent += $swD.Elapsed.TotalSeconds
    }
}

# --- COM connection, held open across requests ---
$script:App = $null

function Connect-App {
    if ($script:App -ne $null) {
        # A cached connection can outlive the IDE it points at: the coding loop
        # closes the IDE to write code, then starts it again. The dead proxy stays
        # valid as an object, so without this probe every later call fails with
        # "The RPC server is unavailable" (0x800706BA) until the bridge restarts.
        #
        # Require a REAL answer, not merely "did not throw": a half-dead proxy
        # returns an empty Version and then fails the next call, which is exactly
        # how a stale connection slipped through the earlier check.
        try {
            $probe = [string]$script:App.Version
            if (-not [string]::IsNullOrWhiteSpace($probe)) { return $script:App }
            Log "cached connection answered with an empty Version; dropping it"
        } catch {
            Log "cached connection failed its probe ($($_.Exception.Message)); dropping it"
        }
        $script:App = $null
    }
    if (-not (Get-IdeWindow)) {
        # A freshly launched IDE has a live Mwt process before it has a top-level window,
        # and the coding loop closes and restarts the IDE constantly. Polling while the
        # process exists turns "start_ide then open" from a spurious refusal into a wait.
        # When no Mwt process exists there is genuinely no IDE, and the refusal stands at
        # once rather than making every request pay a timeout.
        $deadline = (Get-Date).AddSeconds(20)
        while ((Get-Date) -lt $deadline -and -not (Get-IdeWindow) -and (Get-Process -Name Mwt -ErrorAction SilentlyContinue)) {
            Start-Sleep -Milliseconds 400
        }
        if (Get-IdeWindow) { Log 'IDE window appeared while waiting for a freshly started IDE' }
    }
    if (-not (Get-IdeWindow)) {
        throw "no running MotionWorks IDE window; refusing to instantiate (that would launch a new IDE and a trial licence permits only one instance). Use the 'start_ide' verb to launch one deliberately."
    }
    $script:App = New-Object -ComObject Ade.Application.550
    Log "connected: Version=$($script:App.Version)"
    return $script:App
}

function Normalize-MwPath([string]$path) {
    if ([string]::IsNullOrWhiteSpace($path)) { return '' }
    try { return [IO.Path]::GetFullPath($path).TrimEnd('\') } catch { return $path.Trim().TrimEnd('\') }
}

function Set-RequestScope($req) {
    $verb = [string]$req.verb
# Scope is supplied for EACH request, never inherited from the last chat.
$script:WorkspaceRoot = $null
$script:StageRoot = ''
if ($verb -notin @('ping', 'stop')) {
    if ([string]::IsNullOrWhiteSpace([string]$req.workspace) -or
        -not [IO.Path]::IsPathRooted([string]$req.workspace)) {
        throw 'REFUSED: the bridge request has no absolute session workspace.'
    }
    Assert-NoLinkedPath ([string]$req.workspace)
    $script:WorkspaceRoot = Normalize-MwPath ([string]$req.workspace)
    $script:StageRoot = Join-Path $script:WorkspaceRoot '.motionworks\stage'
    Assert-NoLinkedPath $StageRoot
    if (-not ((Normalize-MwPath ([string]$req.stage_root)).Equals((Normalize-MwPath $StageRoot), [StringComparison]::OrdinalIgnoreCase))) {
        throw 'REFUSED: bridge stage does not match the request workspace.'
    }
}
}

function Assert-NoLinkedPath([string]$path) {
    $cursor = [IO.Path]::GetFullPath($path)
    while ($cursor) {
        if (Test-Path -LiteralPath $cursor) {
            $item = Get-Item -LiteralPath $cursor -Force -ErrorAction Stop
            if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
                throw "REFUSED: linked path cannot be used by the IDE bridge: $cursor"
            }
        }
        $parent = [IO.Path]::GetDirectoryName($cursor)
        if ($parent -eq $cursor) { break }
        $cursor = $parent
    }
}

function Test-InsideWorkspace([string]$path) {
    if ([string]::IsNullOrWhiteSpace($path) -or -not $script:WorkspaceRoot) { return $false }
    Assert-NoLinkedPath $path
    $full = Normalize-MwPath $path
    $root = Normalize-MwPath $script:WorkspaceRoot
    return ($full.Equals($root, [StringComparison]::OrdinalIgnoreCase) -or
        $full.StartsWith($root + '\', [StringComparison]::OrdinalIgnoreCase))
}

function Test-InsideStage([string]$path) {
    if (-not (Test-InsideWorkspace $path)) { return $false }
    $full = Normalize-MwPath $path
    $root = Normalize-MwPath $StageRoot
    if (-not $full -or -not $root) { return $false }
    return ($full.Equals($root, [StringComparison]::OrdinalIgnoreCase) -or
            $full.StartsWith($root + '\', [StringComparison]::OrdinalIgnoreCase))
}

function Test-SameProject([string]$active, [string]$requested) {
    $a = Normalize-MwPath $active
    $r = Normalize-MwPath $requested
    if (-not $a -or -not $r) { return $false }
    $bare = {
        param($p)
        if ($p.EndsWith('.mwt', [StringComparison]::OrdinalIgnoreCase)) { return $p.Substring(0, $p.Length - 4) }
        return $p
    }
    $aBare = & $bare $a
    $rBare = & $bare $r
    return $aBare.Equals($rBare, [StringComparison]::OrdinalIgnoreCase)
}

function Get-MwSha256([string]$path) {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    $stream = [System.IO.File]::OpenRead($path)
    try { return [System.BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-', '') }
    finally { $stream.Dispose(); $sha.Dispose() }
}

function Get-OpenProjectPath($app) {
    try {
        if (-not $app.IsProjectOpen()) { return $null }
        $name = [string]$app.ActiveProject.FullName
        if ([string]::IsNullOrWhiteSpace($name)) { return $null }
        return $name
    } catch { return $null }
}

# Every live IDE verb that compiles, saves, or reads the open project calls this.
# A project outside stage/ is the wrong project — often one MotionWorks restored,
# or one the .mwt wrapper still pointed at — and it is not edited from here.
function Assert-ProvenCopy([string]$path) {
    # A directory under stage/ is not provenance. mw_ide_stage writes <name>.identity.json
    # with the workspace source. Compile and save refuse a copy that has none.
    $full = Normalize-MwPath $path
    if ($full.EndsWith('.mwt', [StringComparison]::OrdinalIgnoreCase)) {
        $full = $full.Substring(0, $full.Length - 4)
    }
    $name = [IO.Path]::GetFileName($full)
    $ident = Join-Path (Normalize-MwPath $StageRoot) ($name + '.identity.json')
    Assert-NoLinkedPath $ident
    if (-not (Test-Path -LiteralPath $ident)) {
        throw "REFUSED: '$path' has no identity file. Stage it from the workspace with mw_ide_stage. A project dropped into stage is not compiled or saved."
    }
    try { $raw = Get-Content -LiteralPath $ident -Raw -Encoding UTF8 | ConvertFrom-Json } catch {
        throw "REFUSED: could not read the identity for '$name'."
    }
    if ([string]::IsNullOrWhiteSpace([string]$raw.source)) {
        throw "REFUSED: staged project '$name' has no recorded source. Stage it again from the workspace project before compiling or saving it."
    }
    if (-not (Test-InsideStage $path) -or
        -not (Test-InsideWorkspace ([string]$raw.source)) -or
        -not (Test-InsideWorkspace ([string]$raw.source_directory)) -or
        -not ((Normalize-MwPath ([string]$raw.workspace)).Equals((Normalize-MwPath $script:WorkspaceRoot), [StringComparison]::OrdinalIgnoreCase)) -or
        -not (Test-SameProject ([string]$raw.staged_mwt) $path) -or
        -not (Test-SameProject ([string]$raw.staged_directory) $path) -or
        -not (Test-SameProject ([string]$raw.bound_to) $path)) {
        throw "REFUSED: project identity does not belong to this request's workspace."
    }

}

function Assert-StagedOpen($app, [string]$what) {
    $path = Get-OpenProjectPath $app
    if (-not $path) { throw 'no project is open in the IDE' }
    if (-not (Test-InsideStage $path)) {
        throw ("REFUSED: {0} would act on '{1}', which is outside the staging root '{2}'. " +
               "That is not the staged workspace copy. Close it, or open the staged project " +
               "with mw_ide_open. A program outside the workspace can be read with " +
               "mw_code_read_st { reference: true } and is never opened or edited here.") -f $what, $path, $StageRoot
    }
    Assert-ProvenCopy $path
    return $path
}

Log "bridge started pid=$PID bits=$([IntPtr]::Size * 8) stage=$StageRoot"

while ($true) {
    if (-not (Test-Path $reqPath)) { Start-Sleep -Milliseconds $PollMs; continue }

    $raw = $null; $req = $null
    try { $raw = Get-Content -Path $reqPath -Raw -Encoding UTF8; $req = $raw | ConvertFrom-Json }
    catch { Start-Sleep -Milliseconds $PollMs; continue }   # half-written; retry
    if ($null -eq $req -or $null -eq $req.verb) { Start-Sleep -Milliseconds $PollMs; continue }

    $id = $req.id
    $verb = [string]$req.verb
    Log "req id=$id verb=$verb"

    $data = $null; $err = $null; $ok = $false
    try {
        Set-RequestScope $req
        switch ($verb) {

            'ping' {
                $ok = $true
                $data = [ordered]@{ alive = $true; workspace_protocol = 3; ide_window = (Get-IdeWindow -ne $null) }
            }

            'stop' {
                # Consume the request BEFORE exiting. Leaving req.json behind means
                # the next bridge to start immediately reads this stale stop and
                # dies on launch.
                Remove-Item -Force $reqPath -ErrorAction SilentlyContinue
                Write-Result $id $verb $true ([ordered]@{ stopping = $true }) $null
                Log "stop requested; exiting"
                Remove-BridgeLock
                if ($script:App -ne $null) { try { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($script:App) } catch { } }
                exit 0
            }

            'status' {
                $app = Connect-App
                $ideW = Get-IdeWindow
                $isOpen = $null; $activeName = $null
                try { $isOpen = $app.IsProjectOpen() } catch { $isOpen = $null }
                if ($isOpen) { try { $activeName = $app.ActiveProject.FullName } catch { } }
                $inStage = $false
                if ($activeName) { $inStage = Test-InsideStage $activeName }
                $ok = $true
                $data = [ordered]@{
                    version         = [string]$app.Version
                    ide_window      = ("0x{0:X}" -f ([int64]$ideW))
                    is_project_open = $isOpen
                    active_project  = $activeName
                    in_stage        = [bool]$inStage
                }
            }

            'open' {
                # The cached Application can describe a project that no longer
                # exists once this has run; drop it so the next verb reconnects.
                $script:App = $null
                $path = [string]$req.path
                if ([string]::IsNullOrWhiteSpace($path)) { throw 'open requires "path"' }
                # Fresh dialog budget for this call, so a long session of opens cannot
                # inherit a spent budget and silently stop answering prompts.
                $script:dialogSpent = 0.0
                $swOpen = [Diagnostics.Stopwatch]::StartNew()
                $full = [IO.Path]::GetFullPath($path)
                $stageFull = [IO.Path]::GetFullPath($StageRoot)
                if (-not (Test-InsideStage $full)) {
                    throw "REFUSED: '$full' is outside the staging root '$stageFull'. Only staged copies may be opened."
                }
                if (-not (Test-Path $full)) { throw "project not found: $full" }
                Assert-ProvenCopy $full
                $digest = Get-MwSha256 $full
                if (-not $req.wrapper_sha256 -or $digest -ne [string]$req.wrapper_sha256) {
                    throw 'REFUSED: wrapper binding must be verified by mw_ide_open before opening.'
                }
                $app = Connect-App
                # A project already in the window is not the one this call asked for until
                # it is. An unmodified foreign project is closed without saving so the staged
                # copy can take its place. Unsaved changes on that other project are left alone.
                $dismissed = $null
                $prior = Get-OpenProjectPath $app
                if ($prior -and -not (Test-SameProject $prior $full)) {
                    $modified = $false
                    try { $modified = [bool]$app.ActiveProject.IsModified } catch { }
                    if ($modified) {
                        throw "REFUSED: the IDE already has '$prior' open with unsaved changes. That project was left untouched. Save or close it in MotionWorks before opening the staged project '$full'."
                    }
                    try {
                        $app.ActiveProject.Close($false)
                        $dismissed = $prior
                        Log "closed other project before open: $prior"
                    } catch {
                        throw "REFUSED: the IDE has '$prior' open and it could not be closed ($($_.Exception.Message)). The staged project '$full' was not opened."
                    }
                }
                # From Ade.tlb: OpenProject(Name, ConfirmConvert). ConfirmConvert=$false
                # suppresses the conversion prompt, which would otherwise block an
                # unattended flow on a modal dialog nobody is there to answer.
                #
                # RETRY on "Internal error": a freshly launched IDE has not finished
                # initialising its project services, and OpenProject fails with
                # "Internal error in 'OpenProject'" until it has. Reporting that as a
                # failure made start->open look broken when it only needed time.
                $opened = $false; $lastErr = $null
                # A PARALLEL WATCHER, because this thread is about to be blocked.
                #
                # OpenProject is a synchronous out-of-process COM call. When
                # MotionWorks raises a prompt DURING the load ("this project was not
                # closed cleanly, load anyway?"), the server enters a modal loop and
                # the call does not return until that prompt is answered. So the retry
                # loop below cannot help - no catch ever fires, no timeout applies.
                # Measured: the request was logged and then sat for minutes unanswered.
                # Only another process can press that button, so start one.
                $watcher = $null
                try {
                    # Never let watchers accumulate. A watcher is started per open and
                    # killed when the load finishes, but any path that throws first
                    # leaves one behind - and FOUR were observed running at once after
                    # a run of failed opens. Overlapping watchers all click whatever
                    # dialog they find, which is exactly the kind of interference that
                    # makes an open fail for no visible reason. Clear them first.
                    try {
                        Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
                            Where-Object { $_.CommandLine -and $_.CommandLine -match 'watch_dialogs' } |
                            ForEach-Object {
                                Log "clearing stale dialog watcher pid=$($_.ProcessId)"
                                Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
                            }
                    } catch { }

                    $watchCmd = Join-Path $BridgeDir 'watch_dialogs.cmd'
                    if (Test-Path $watchCmd) {
                        $watcher = Start-Process -FilePath 'cmd.exe' `
                            -ArgumentList '/c', "`"$watchCmd`" 200" `
                            -WindowStyle Hidden -PassThru
                        Log "dialog watcher started pid=$($watcher.Id)"
                    }
                } catch { Log "dialog watcher failed to start: $($_.Exception.Message)" }

                # 60s, not 90s: the retry window, the post-load dialog answers and the
                # verification loop all share the caller's timeout, and the client
                # gives up at 150s. Sizing each part as if it had the budget alone is
                # what produced "timed out waiting for the bridge".
                #
                # The attempt cap matters as much as the deadline. A blocked
                # OpenProject takes ~30s to fail, and the deadline is only consulted
                # BETWEEN attempts, so an unbounded loop overshoots wildly: measured
                # a "90s" loop running 443 seconds and a "60s" loop running 233.
                # Three attempts is enough to cover IDE warm-up and still return
                # inside the caller's budget.
                $deadline = (Get-Date).AddSeconds(60)
                $pass = 0
                while ((Get-Date) -lt $deadline -and $pass -lt 3) {
                    $pass++
                    # Answer any prompt the IDE is waiting on BEFORE calling again.
                    # While a modal dialog is up the frame is disabled and
                    # OpenProject cannot succeed, so retrying blindly just burns
                    # the deadline - which is what made start->open look broken.
                    # Checked on a stride, because inspection is not free while the
                    # IDE's UI thread is busy.
                    if ($pass % 3 -eq 1) { [void](Resolve-KnownDialogs) }
                    try { $app.OpenProject($full, $false); $opened = $true; break }
                    catch {
                        $lastErr = $_.Exception.Message
                        if ($lastErr -notmatch 'Internal error') { throw }
                        Start-Sleep -Seconds 2
                    }
                }
                Log "open attempt(s)=$pass opened=$opened elapsed=$([Math]::Round($swOpen.Elapsed.TotalSeconds,1))s requested=$full"
                if (-not $opened) {
                    if ($watcher) { try { Stop-Process -Id $watcher.Id -Force -ErrorAction SilentlyContinue } catch { } }
                    throw "OpenProject never succeeded within 60s; last error: $lastErr"
                }
                # Verify what actually happened rather than trusting the call.
                # MotionWorks asks "defragment?" / "load anyway?" DURING and AFTER
                # the load, so keep answering while we wait for services to appear.
                #
                # Dialogs are inspected every 4th pass, not every pass: while the IDE
                # is loading, its UI thread is busy and each cross-process text read
                # waits out its timeout, so inspecting on all 40 passes cost more than
                # the whole budget and the open call never returned.
                $verified = $null; $activeName = $null
                for ($i = 0; $i -lt 40; $i++) {
                    Start-Sleep -Milliseconds 500
                    if ($i % 4 -eq 0) { [void](Resolve-KnownDialogs) }
                    try { $verified = $app.IsProjectOpen(); if ($verified) { $activeName = $app.ActiveProject.FullName; break } } catch { }
                }
                # The load is over - either way the watcher has nothing left to do, and
                # leaving it running would let it answer a prompt raised by some later,
                # unrelated step.
                if ($watcher) {
                    try { Stop-Process -Id $watcher.Id -Force -ErrorAction SilentlyContinue; Log "dialog watcher stopped" } catch { }
                }
                $matches = Test-SameProject $activeName $full
                $inStage = Test-InsideStage $activeName
                Log "open loaded active=$activeName matches=$matches inStage=$inStage"
                if ($verified -and (-not $matches -or -not $inStage)) {
                    try { $app.ActiveProject.Close($false); Log "closed mismatched project $activeName" } catch {
                        Log "could not close mismatched project: $($_.Exception.Message)"
                    }
                    throw "REFUSED: asked to open '$full' but the IDE loaded '$activeName'. That is not the staged workspace copy, so it was closed without saving."
                }
                $ok = [bool]$verified -and $matches -and $inStage
                $data = [ordered]@{
                    requested          = $full
                    is_project_open    = [bool]$verified
                    active_project     = $activeName
                    matches_request    = [bool]$matches
                    in_stage           = [bool]$inStage
                    dismissed_project  = $dismissed
                }
                if (-not $verified) {
                    $blocking = @(Get-IdeDialogs)
                    if ($blocking.Count -gt 0) {
                        throw "OpenProject did not complete: the IDE is blocked by an unanswered dialog - '$($blocking[0].message)' (buttons: $(($blocking[0].buttons | ForEach-Object { $_.label }) -join ', ')). The IDE is NOT closed. Answer it, then re-check."
                    }
                    $err = 'OpenProject was called but IsProjectOpen never became true'
                }
            }

            'pous' {
                $app = Connect-App
                [void](Assert-StagedOpen $app $verb)
                $col = $app.ActiveProject.Pous
                $items = @()
                for ($i = 1; $i -le $col.Count; $i++) {
                    $p = $col.Item($i)
                    $items += [ordered]@{ index = $i; name = [string]$p.Name; language = [string]$p.PouLanguage }
                }
                $ok = $true
                $data = [ordered]@{ count = $col.Count; pous = $items }
            }

            # Save the open project through the IDE.
            #
            # Worth having for its own sake, but added to test a specific suspicion: the
            # plugin edits the project ON DISK while the IDE is closed, so when the IDE
            # reopens it may hold a model that disagrees with the files. A compile then
            # runs against an inconsistent view and can report errors that are not in the
            # project - which would explain why adding a program to a task turns a clean
            # build into 125 unresolved-external errors while the files are provably fine.
            'task_model' {
                $app = Connect-App
                [void](Assert-StagedOpen $app $verb)
                $tasks = [ordered]@{}
                $taskNames = @()
                # The resource lookup is the one call here that can fail outright, and it used to
                # take the whole verb down with it: an object model that does not answer for this
                # path returned a response the caller could not read, so `mw_code_task_model`
                # failed with a type error rather than reporting anything about the tasks. The
                # fallback below already lists the task names this project uses.
                try {
                    $resource = $app.ActiveProject.GetObjectByLogicalName(
                        'Hardware/Configuration/Resource', 10)
                } catch {
                    Log "task_model: resource lookup failed ($($_.Exception.Message)); using the known task names"
                    $resource = $null
                }
                if ($resource -ne $null) {
                    try {
                        $coll = $resource.Tasks
                        for ($i = 1; $i -le $coll.Count; $i++) { $taskNames += $coll.Item($i).Name }
                    } catch {
                        Log "task_model: reading the task collection failed ($($_.Exception.Message))"
                        $taskNames = @()
                    }
                }
                if ($taskNames.Count -eq 0) {
                    foreach ($t in @('BG', 'FastTsk', 'MedTsk', 'SlowTsk', 'Start')) {
                        $taskNames += $t
                    }
                }
                foreach ($name in $taskNames) {
                    $path = "Hardware/Configuration/Resource/Tasks/$name"
                    try {
                        $task = $app.ActiveProject.GetObjectByLogicalName($path, 11)
                        if ($task -eq $null) { continue }
                        $pi = $task.ProgramInstances
                        $instances = @()
                        for ($j = 1; $j -le $pi.Count; $j++) {
                            $inst = $pi.Item($j)
                            $instances += [ordered]@{
                                name         = [string]$inst.Name
                                type         = [string]$inst.Type
                                logical_name = [string]$inst.LogicalName
                            }
                        }
                        $tasks[$name] = [ordered]@{
                            name         = [string]$task.Name
                            cycle        = [string]$task.Type
                            logical_name = [string]$task.LogicalName
                            instances    = $instances
                        }
                    } catch {
                        $tasks[$name] = [ordered]@{ error = $_.Exception.Message }
                    }
                }
                $ok = $true
                $data = [ordered]@{ tasks = $tasks; source = 'com' }
            }

            'create_task' {
                $app = Connect-App
                [void](Assert-StagedOpen $app $verb)
                $name = [string]$req.name
                $kind = [string]$req.kind
                if ([string]::IsNullOrWhiteSpace($name)) { throw 'create_task requires "name"' }
                if ($name.Length -gt 7) { throw "MotionWorks IEC task names are limited to 7 characters; '$name' has $($name.Length)." }
                if ([string]::IsNullOrWhiteSpace($kind)) { $kind = 'CYCLIC' }

                $resource = $app.ActiveProject.GetObjectByLogicalName(
                    'Hardware/Configuration/Resource', 10)
                if ($resource -eq $null) { throw 'no resource found in the active project' }
                $tasks = $resource.Tasks
                $before = $tasks.Count

                foreach ($i in 1..$before) {
                    if ([string]$tasks.Item($i).Name -eq $name) {
                        throw "a task named '$name' already exists"
                    }
                }

                $tasks.GetType().InvokeMember('Create', 'InvokeMethod', $null, $tasks,
                    @([string]$name, [string]$kind)) | Out-Null
                $after = $tasks.Count

                $app.ActiveProject.Save()
                Start-Sleep -Milliseconds 400

                $names = @()
                for ($i = 1; $i -le $tasks.Count; $i++) { $names += [string]$tasks.Item($i).Name }
                $made = $null
                for ($i = 1; $i -le $tasks.Count; $i++) {
                    if ([string]$tasks.Item($i).Name -eq $name) { $made = $tasks.Item($i) }
                }
                $ok = $true
                $data = [ordered]@{
                    created      = $true
                    name         = $name
                    cycle        = $kind
                    before       = $before
                    after        = $after
                    tasks        = $names
                    logical_name = if ($made) { [string]$made.LogicalName } else { $null }
                }
            }

            'delete_task' {
                $app = Connect-App
                [void](Assert-StagedOpen $app $verb)
                $name = [string]$req.name
                if ([string]::IsNullOrWhiteSpace($name)) { throw 'delete_task requires "name"' }

                $resource = $app.ActiveProject.GetObjectByLogicalName(
                    'Hardware/Configuration/Resource', 10)
                if ($resource -eq $null) { throw 'no resource found in the active project' }
                $tasks = $resource.Tasks
                $before = $tasks.Count

                $hit = -1
                for ($i = 1; $i -le $tasks.Count; $i++) {
                    if ([string]$tasks.Item($i).Name -eq $name) { $hit = $i; break }
                }
                if ($hit -lt 0) {
                    $names = @()
                    for ($i = 1; $i -le $tasks.Count; $i++) { $names += [string]$tasks.Item($i).Name }
                    throw "no task named '$name'. Tasks: $($names -join ', ')"
                }
                $task = $tasks.Item($hit)
                $kids = $task.ProgramInstances.Count
                if ($kids -gt 0) {
                    throw "task '$name' still has $kids program instance(s) assigned; unassign them first"
                }
                $task.Delete()
                $after = $tasks.Count

                $app.ActiveProject.Save()
                Start-Sleep -Milliseconds 400

                $names = @()
                for ($i = 1; $i -le $tasks.Count; $i++) { $names += [string]$tasks.Item($i).Name }
                $ok = $true
                $data = [ordered]@{
                    deleted = $true
                    name    = $name
                    before  = $before
                    after   = $after
                    tasks   = $names
                }
            }

            'assign_pou' {
                $app = Connect-App
                [void](Assert-StagedOpen $app $verb)
                $taskName = [string]$req.task
                $pouName = [string]$req.pou
                $instName = $req.instance
                if ([string]::IsNullOrWhiteSpace($instName)) { $instName = $pouName }
                $progType = $req.type
                if ([string]::IsNullOrWhiteSpace($progType)) { $progType = $pouName }
                if ([string]::IsNullOrWhiteSpace($taskName)) { throw 'assign requires "task"' }
                if ([string]::IsNullOrWhiteSpace($pouName)) { throw 'assign requires "pou"' }

                $path = "Hardware/Configuration/Resource/Tasks/$taskName"
                $task = $app.ActiveProject.GetObjectByLogicalName($path, 11)
                if ($task -eq $null) { throw "no task named '$taskName' (looked for $path)" }

                $pi = $task.ProgramInstances
                $before = $pi.Count
                $pi.GetType().InvokeMember('Create', 'InvokeMethod', $null, $pi,
                    @([string]$instName, [string]$progType)) | Out-Null
                $after = $pi.Count

                $app.ActiveProject.Save()
                Start-Sleep -Milliseconds 400

                $instances = @()
                for ($j = 1; $j -le $pi.Count; $j++) { $instances += [string]$pi.Item($j).Name }
                $ok = $true
                $data = [ordered]@{
                    assigned    = $true
                    task        = $taskName
                    pou         = $pouName
                    instance    = [string]$instName
                    type        = [string]$progType
                    before      = $before
                    after       = $after
                    instances   = $instances
                    logical_name = [string]$pi.Item($after).LogicalName
                }
            }

            'unassign_pou' {
                $app = Connect-App
                [void](Assert-StagedOpen $app $verb)
                $taskName = [string]$req.task
                $pouName = [string]$req.pou
                if ([string]::IsNullOrWhiteSpace($taskName)) { throw 'unassign requires "task"' }
                if ([string]::IsNullOrWhiteSpace($pouName)) { throw 'unassign requires "pou"' }

                $path = "Hardware/Configuration/Resource/Tasks/$taskName"
                $task = $app.ActiveProject.GetObjectByLogicalName($path, 11)
                if ($task -eq $null) { throw "no task named '$taskName' (looked for $path)" }

                $pi = $task.ProgramInstances
                $before = $pi.Count
                $hit = -1
                for ($j = 1; $j -le $pi.Count; $j++) {
                    if ([string]$pi.Item($j).Name -eq $pouName) { $hit = $j; break }
                }
                if ($hit -lt 0) {
                    $names = @()
                    for ($j = 1; $j -le $pi.Count; $j++) { $names += [string]$pi.Item($j).Name }
                    throw "'$pouName' is not assigned to task '$taskName'. Assigned: $($names -join ', ')"
                }
                $pi.Item($hit).Delete()
                $after = $pi.Count

                $app.ActiveProject.Save()
                Start-Sleep -Milliseconds 400

                $instances = @()
                for ($j = 1; $j -le $pi.Count; $j++) { $instances += [string]$pi.Item($j).Name }
                $ok = $true
                $data = [ordered]@{
                    unassigned = $true
                    task       = $taskName
                    pou        = $pouName
                    before     = $before
                    after      = $after
                    instances  = $instances
                }
            }

            'save' {
                $app = Connect-App
                [void](Assert-StagedOpen $app $verb)
                $swSave = [Diagnostics.Stopwatch]::StartNew()
                $app.ActiveProject.Save()
                $swSave.Stop()
                Start-Sleep -Milliseconds 500
                $ok = $true
                $data = [ordered]@{
                    saved       = $true
                    elapsed_s   = [math]::Round($swSave.Elapsed.TotalSeconds, 2)
                    is_modified = [bool]$app.ActiveProject.IsModified
                    is_compiled = [bool]$app.ActiveProject.IsCompiled
                }
            }

            'compile_state' {
                $app = Connect-App
                [void](Assert-StagedOpen $app $verb)
                $ok = $true
                $data = [ordered]@{
                    is_compiled = [bool]$app.ActiveProject.IsCompiled
                    is_modified = [bool]$app.ActiveProject.IsModified
                }
            }

            # Compile types, read from Ade.tlb. The earlier 1=Build / 2=Rebuild guess
            # was WRONG:
            #   1 adeCtMake   2 adeCtBuild   3 adeCtPatch   4 adeCtWorksheet   5 adeCtDataTypes
            # There is no Rebuild compile type: Rebuild is a COMMAND
            # (adeCmdBuildRebuildProject = 36570), and ExecuteCommand is a stub in
            # this build ("The method or operation is not implemented"), so Rebuild
            # is not reachable programmatically at all.
            'make'      { $mode = 1 }
            'build'     { $mode = 2 }
            'rebuild'   { $mode = $null }
            'patch'     { $mode = 3 }
            'worksheet' { $mode = 4 }
            'datatypes' { $mode = 5 }

            # Resolve a menu command NAME to its numeric id without running it.
            # This is the safe half of ExecuteCommand and the way to discover
            # which commands this build of the IDE actually exposes.
            'command_id' {
                $name = [string]$req.name
                if ([string]::IsNullOrWhiteSpace($name)) { throw 'command_id requires "name"' }
                $app = Connect-App
                $cid = $app.GetIdOfCommand($name)
                $ok = $true
                $data = [ordered]@{ name = $name; command_id = $cid; known = ($cid -ne 0) }
            }

            # Drive an IDE menu command by name - the programmatic equivalent of
            # clicking the menu, without synthesising any input.
            'command' {
                $name = [string]$req.name
                if ([string]::IsNullOrWhiteSpace($name)) { throw 'command requires "name"' }
                if ($name -ne 'adeCmdBuildRebuildProject') { throw 'Only the offline Rebuild command is allowed; use the dedicated rebuild tool' }
                $app = Connect-App
                [void](Assert-StagedOpen $app 'command')
                $cid = $app.GetIdOfCommand($name)
                if ($cid -eq 0) { throw "unknown command '$name' (GetIdOfCommand returned 0)" }
                $app.ExecuteCommand($cid)
                $ok = $true
                $data = [ordered]@{ name = $name; command_id = $cid; executed = $true }
            }

            'feature_state' {
                $name = [string]$req.name
                if ([string]::IsNullOrWhiteSpace($name)) { throw 'feature_state requires "name"' }
                $app = Connect-App
                $ok = $true
                $data = [ordered]@{ name = $name; state = $app.GetFeatureState($name) }
            }

            # Live variable model. This is the part that makes editing THROUGH the
            # IDE possible: reading variables from the running project avoids
            # hand-maintaining .VGR/.VB/PROJECT.TRE consistency entirely.
            # Optional "pou" narrows to one POU; omitted reads all of them.
            'variables' {
                $app = Connect-App
                [void](Assert-StagedOpen $app $verb)
                $want = [string]$req.pou
                $pous = $app.ActiveProject.Pous
                $result = @()
                for ($i = 1; $i -le $pous.Count; $i++) {
                    $p = $pous.Item($i)
                    $pname = [string]$p.Name
                    if (-not [string]::IsNullOrWhiteSpace($want) -and $pname -ne $want) { continue }

                    $items = @()
                    try {
                        $vs = $p.Variables
                        for ($k = 1; $k -le $vs.Count; $k++) {
                            $v = $vs.Item($k)
                            $items += [ordered]@{
                                name          = [string]$v.Name
                                data_type     = $(try { [string]$v.DataType } catch { $null })
                                initial_value = $(try { [string]$v.InitialValue } catch { $null })
                                iec_address   = $(try { [string]$v.IecAddress } catch { $null })
                            }
                        }
                    } catch { }

                    $groups = @()
                    try {
                        $gs = $p.Variables.Groups
                        for ($g = 1; $g -le $gs.Count; $g++) {
                            $grp = $gs.Item($g)
                            $gv = @()
                            try {
                                $gvv = $grp.Variables
                                for ($m = 1; $m -le $gvv.Count; $m++) { $gv += [string]$gvv.Item($m).Name }
                            } catch { }
                            $groups += [ordered]@{ name = [string]$grp.Name; count = $gv.Count; variables = $gv }
                        }
                    } catch { }

                    $result += [ordered]@{ pou = $pname; count = $items.Count; variables = $items; groups = $groups }
                }
                $ok = $true
                $data = [ordered]@{ pous = $result }
            }

            # Launch the IDE deliberately. Needed after close_ide, because the write
            # engine requires the IDE to be closed while code changes are applied.
            # Connect-App refuses to launch implicitly, so this is the only place
            # that starts the IDE - and Mwt.exe is launched with no project, then
            # `open` loads one, because a bare launch has no project services.
            'start_ide' {
                $launchProject = [string]$req.path
                Assert-ProvenCopy $launchProject
                $digest = Get-MwSha256 $launchProject
                if (-not $req.wrapper_sha256 -or $digest -ne [string]$req.wrapper_sha256) {
                    throw 'REFUSED: startup requires a verified workspace wrapper.'
                }
                $exe = [string]$req.exe
                if ([string]::IsNullOrWhiteSpace($exe)) {
                    $exe = 'C:\Program Files (x86)\Yaskawa\MotionWorks IEC 3 Pro\Mwt.exe'
                }
                $already = [bool](Get-IdeWindow)
                $trialAnswered = $null
                $trialSeen = $false
                if (-not $already) {
                    if (-not (Test-Path $exe)) { throw "Mwt.exe not found at $exe" }
                    Start-Process -FilePath $exe -ArgumentList ('"' + $launchProject + '"') -WindowStyle Hidden | Out-Null
                    # 300s, not 120s: measured on this machine the IDE can take
                    # well over two minutes to show its window (licence check and
                    # CodeMeter are part of startup). A shorter wait made a merely
                    # slow start look like a failure to launch.
                    $deadline = (Get-Date).AddSeconds(300)
                    while (-not (Get-IdeWindow) -and (Get-Date) -lt $deadline) {
                        Start-Sleep -Milliseconds 1000
                        # An UNLICENSED build shows the licence dialog FIRST and will
                        # never produce an IDE window until it is answered. Waiting
                        # blindly therefore looks exactly like a hang. Detect it and
                        # answer it with "Use Trial".
                        if (-not $trialSeen) {
                            $pair = Get-TrialDialog
                            if ($pair[0] -and $pair[1]) {
                                $trialSeen = $true
                                Log 'licence dialog detected during start_ide; answering it'
                                Invoke-TrialClick $pair[1] $pair[0]
                                [void][MWW]::SendMessage($pair[1], 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero)
                                $gone = Test-TrialGone $pair[0] 30
                                $trialAnswered = [bool]$gone
                                Log "licence dialog answered=$($trialAnswered) after ${gone}s"
                            }
                        }
                    }
                }
                $w = Get-IdeWindow
                if (-not $w) {
                    $pair = Get-TrialDialog
                    if ($pair[0]) {
                        throw 'the IDE never showed its window because the LICENCE dialog is up and could not be answered automatically. Click "Use Trial" by hand, or activate a licence. This affects only the mw_ide_* tools: the mw_code_* tools work without the IDE and without a licence.'
                    }
                    throw 'the IDE window did not appear within 300s'
                }
                # Force a fresh connection: the previous one pointed at the old process.
                $script:App = $null
                $app = Connect-App
                # A bare Mwt.exe launch restores the last project. That project is
                # often outside the workspace. When WE just launched the IDE, close
                # it without saving so the window is not left on it. An IDE that was
                # already running is left as the user had it, and named so the caller
                # can see it is not the staged copy.
                $dismissed = $null
                $foreign = $null
                $openPath = Get-OpenProjectPath $app
                Log "start_ide already=$already openPath=$openPath"
                # A bare launch restores the last project. That is how an outside
                # project appeared in the window and then got built. When WE just
                # launched, close whatever came up, in stage or not.
                if ($openPath -and -not $already -and -not (Test-SameProject $openPath $launchProject)) {
                    try {
                        $app.ActiveProject.Close($false)
                        $dismissed = $openPath
                        Log "dismissed auto-opened project $openPath"
                    } catch {
                        $foreign = $openPath
                        Log "could not dismiss auto-opened project: $($_.Exception.Message)"
                    }
                } elseif ($openPath -and -not (Test-InsideStage $openPath)) {
                    $foreign = $openPath
                }
                if ($foreign) {
                    throw "REFUSED: MotionWorks has an unrelated project open: $foreign. Save or close it manually; no project operation was performed."
                }
                $ok = $true
                $data = [ordered]@{
                    already_running    = $already
                    ide_window         = ("0x{0:X}" -f ([int64]$w))
                    version            = [string]$app.Version
                    launched_exe       = $exe
                    trial_dialog       = $trialSeen
                    trial_answered     = $trialAnswered
                    dismissed_project  = $dismissed
                    foreign_project    = $foreign
                }
            }

            # What the IDE is ACTUALLY doing, including modal dialogs the COM API
            # cannot see. Call this after every IDE step.
            #
            # While a dialog is up, the automation API reports nothing useful:
            # IsProjectOpen() is false or throws and OpenProject fails. An agent
            # reading only COM concludes "no project open" or "the IDE has closed"
            # when the IDE is in fact waiting for a button. This is the antidote.
            'ide_state' {
                $ok = $true
                $data = Get-IdeState
            }

            # Answer a modal dialog the IDE is waiting on.
            #
            # These are standard Win32 dialogs, so a BM_CLICK to the button handle
            # is enough - no synthetic input, no focus games.
            'answer_dialog' {
                $dialogs = Get-IdeDialogs
                if ($dialogs.Count -eq 0) {
                    $ok = $true
                    $data = [ordered]@{ answered = $false; reason = 'no modal dialog is up' }
                } else {
                    $target = $null
                    if ($req.handle) {
                        $target = $dialogs | Where-Object { $_.handle -eq [string]$req.handle } | Select-Object -First 1
                    }
                    if (-not $target) { $target = $dialogs | Where-Object { $_.enabled } | Select-Object -First 1 }
                    if (-not $target) { $target = $dialogs | Select-Object -First 1 }

                    $wantLabel = if ($req.button) { ([string]$req.button) -replace '&', '' } else { $null }
                    $wantId = $req.button_id

                    $btn = $null
                    if ($null -ne $wantId) {
                        $btn = $target.buttons | Where-Object { $_.id -eq [int]$wantId } | Select-Object -First 1
                    }
                    if (-not $btn -and $wantLabel) {
                        $btn = $target.buttons | Where-Object {
                            $_.label -ieq $wantLabel -or $_.label -ilike "$wantLabel*"
                        } | Select-Object -First 1
                    }
                    if (-not $btn -and $wantLabel -eq 'Yes') {
                        # Win32 message boxes use IDYES=6 / IDNO=7 / IDOK=1 / IDCANCEL=2.
                        $wellKnown = @{ Yes = 6; No = 7; OK = 1; Cancel = 2; Retry = 4; Ignore = 5; Abort = 3 }
                        if ($wellKnown.ContainsKey($wantLabel)) {
                            $btn = $target.buttons | Where-Object { $_.id -eq $wellKnown[$wantLabel] } | Select-Object -First 1
                        }
                    }

                    if (-not $btn) {
                        $labels = ($target.buttons | ForEach-Object { $_.label }) -join ', '
                        throw "no button matching '$wantLabel' on dialog $($target.handle); it offers: $labels"
                    }

                    $bh = $script:dialogButtons["$($target.handle)|$($btn.id)"]
                    if (-not $bh) { throw "button handle for '$($btn.label)' was not captured" }

                    [void][MWW]::SendMessage([IntPtr]$bh, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero)  # BM_CLICK
                    Start-Sleep -Milliseconds 600

                    $stayed = [MWW]::IsWindow([IntPtr]$script:dialogHwnds[$target.handle])
                    $ok = $true
                    $data = [ordered]@{
                        answered       = (-not $stayed)
                        dialog         = $target.handle
                        pressed        = $btn.label
                        pressed_id     = $btn.id
                        dialog_closed  = (-not $stayed)
                        message        = $target.message
                    }
                }
            }

            # this is how you tell "no IDE yet" apart from "the IDE is waiting for
            # a human to answer the licence dialog".
            'trial_state' {
                $pair = Get-TrialDialog
                $d = $pair[0]; $b = $pair[1]
                $ideW = Get-IdeWindow
                $ok = $true
                $data = [ordered]@{
                    dialog_present   = [bool]$d
                    dialog_hwnd      = $(if ($d) { "0x{0:X}" -f ([int64]$d) } else { $null })
                    use_trial_hwnd   = $(if ($b) { "0x{0:X}" -f ([int64]$b) } else { $null })
                    ide_window       = $(if ($ideW) { "0x{0:X}" -f ([int64]$ideW) } else { $null })
                    verifier_running = [bool](Get-Process -Name mwctVerify -ErrorAction SilentlyContinue)
                }
            }

            # Try to answer the licence dialog with "Use Trial".
            #
            # Every strategy is VERIFIED by re-checking the window, and if none of
            # them close it this reports that honestly instead of claiming success.
            # The dialog is a .NET WinForms window in ANOTHER process; from an
            # automated process, clicking it is best-effort, not guaranteed.
            'dismiss_trial' {
                $pair = Get-TrialDialog
                $d = $pair[0]; $b = $pair[1]
                if (-not $d) {
                    $ok = $true
                    $data = [ordered]@{ dialog_present = $false; dismissed = $true; method = 'none-needed' }
                } elseif (-not $b) {
                    throw 'a licence dialog is up but it contains no "Use Trial" button'
                } else {
                    $tried = @(); $method = $null; $secs = 0

                    Invoke-TrialClick $b $d
                    [void][MWW]::SendMessage($b, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero)   # BM_CLICK
                    $secs = Test-TrialGone $d 20; $tried += 'bm_click'
                    if ($secs) { $method = 'bm_click' }

                    if (-not $method) {
                        Invoke-TrialClick $b $d
                        $lp = [IntPtr](5 -bor (5 -shl 16))
                        [void][MWW]::SendMessage($b, 0x0201, [IntPtr]1, $lp)   # WM_LBUTTONDOWN
                        [void][MWW]::SendMessage($b, 0x0202, [IntPtr]0, $lp)   # WM_LBUTTONUP
                        $secs = Test-TrialGone $d 20; $tried += 'mouse_messages'
                        if ($secs) { $method = 'mouse_messages' }
                    }

                    if (-not $method) {
                        Invoke-TrialClick $b $d
                        $lp = [IntPtr](5 -bor (5 -shl 16))
                        [void][MWW]::PostMessage($b, 0x0201, [IntPtr]1, $lp)
                        [void][MWW]::PostMessage($b, 0x0202, [IntPtr]0, $lp)
                        $secs = Test-TrialGone $d 20; $tried += 'posted_mouse'
                        if ($secs) { $method = 'posted_mouse' }
                    }

                    $still = [bool]((Get-TrialDialog)[0])
                    $ok = (-not $still)
                    $data = [ordered]@{
                        dialog_present   = $true
                        dismissed        = (-not $still)
                        method           = $method
                        seconds          = $secs
                        strategies_tried = $tried
                    }
                    if ($still) {
                        $err = 'the licence dialog is still up and could not be answered from this process. Click "Use Trial" once by hand, or activate a licence. NOTE: this only affects the mw_ide_* tools - the mw_code_* tools (read code, write ST, create/delete POUs, edit variables) do NOT need the IDE or a licence and work right now.'
                    }
                }
            }

            # List the IDE's output windows (Build/Errors/Warnings/Infos/...).
            'output_windows' {
                $app = Connect-App
                $ow = $app.OutputWindows
                $names = @()
                for ($i = 1; $i -le $ow.Count; $i++) {
                    try { $names += [string]$ow.Item($i).Name } catch { }
                }
                $ok = $true
                $data = [ordered]@{ count = $names.Count; names = $names }
            }

            # Bring an output window to the front.
            #
            # This is how compile ERRORS are read: the automation API exposes the
            # verdict (IsCompiled) but never the messages, and the output windows
            # have AddEntry/Clear/Activate but no read accessor. Activating the pane
            # and then screenshotting it is the only route to the error text.
            'activate_output' {
                $name = [string]$req.name
                if ([string]::IsNullOrWhiteSpace($name)) { throw 'activate_output requires "name"' }
                $app = Connect-App
                $ow = $app.OutputWindows
                $hit = $null
                for ($i = 1; $i -le $ow.Count; $i++) {
                    try {
                        $w = $ow.Item($i)
                        if ("$($w.Name)" -eq $name) { $w.Activate(); $hit = $w; break }
                    } catch { }
                }
                if ($null -eq $hit) { throw "no output window named '$name'" }
                $ok = $true
                $data = [ordered]@{ name = $name; caption = [string]$hit.Caption; activated = $true }
            }

            # Read an output pane AS TEXT - this is how the agent gets compiler messages.
            #
            # Activating the pane brings its list to the front, then the visible
            # SysListView32 with rows is read through MSAA. Verified against a real
            # failing build: it returns the messages verbatim, for example
            #   "No matching global variable found for 'x:y' in resource 'Resource'!"
            #   "Instance 'CalcSplineMatrix' is used more than once!"
            # which a screenshot could never give an agent that has to act on them.
            'read_output' {
                $name = if ($req.pane) { [string]$req.pane } else { 'Errors' }
                $limit = if ($req.limit) { [int]$req.limit } else { 200 }
                $app = Connect-App
                [void](Assert-StagedOpen $app 'read_output')
                # Activate first: a pane that is not showing has no visible list.
                try {
                    $ow = $app.OutputWindows
                    for ($i = 1; $i -le $ow.Count; $i++) {
                        $w = $ow.Item($i)
                        if ("$($w.Name)" -eq $name) { $w.Activate(); break }
                    }
                } catch { }
                Start-Sleep -Milliseconds 700

                $idePid = Get-IdePid

                # Find the MESSAGE WINDOW first, then read only its lists.
                #
                # Picking "the visible list with the most rows" across the whole IDE is
                # wrong: the Edit Wizard owns a SysListView32 too, so activating a pane
                # that happens to be empty returned the Edit Wizard's contents instead.
                # Scoping to the Message Window excludes every other list in the app.
                $script:msgWin = $null
                $ideWin = Get-IdeWindow
                if ($ideWin) {
                    # The Message Window is a CHILD of the IDE frame (an AfxControlBar120
                    # dock pane), not a top-level window, so EnumWindows never sees it.
                    $cbTop = [MWW+EnumWindowsProc]{
                        param($h, $l)
                        $title = [MWW]::ReadText($h)
                        if ($title -eq 'Message Window' -or $title -eq 'Messages') { $script:msgWin = $h }
                        return $true
                    }
                    [void][MWW]::EnumChildWindows([IntPtr]$ideWin, $cbTop, [IntPtr]::Zero)
                }

                $script:best = $null
                $script:bestRows = 0
                $root = if ($script:msgWin) { [IntPtr]$script:msgWin } else { [IntPtr]::Zero }
                if ($root -ne [IntPtr]::Zero) {
                    $cbList = [MWW+EnumWindowsProc]{
                        param($k, $l2)
                        $cls = New-Object System.Text.StringBuilder 64
                        [void][MWW]::GetClassNameW($k, $cls, 64)
                        if ($cls.ToString() -ne 'SysListView32') { return $true }
                        if (-not [MWW]::IsWindowVisible($k)) { return $true }
                        $rows = [MWW]::ListRowCount($k)
                        # Only the active tab's list is visible; a pane with nothing to
                        # report has rows=0 and is skipped, which is itself the answer.
                        if ($rows -gt $script:bestRows) { $script:bestRows = $rows; $script:best = $k }
                        return $true
                    }
                    [void][MWW]::EnumChildWindows($root, $cbList, [IntPtr]::Zero)
                }

                if ($null -eq $script:best) {
                    $ok = $true
                    $data = [ordered]@{ pane = $name; lines = @(); count = 0; note = 'no readable list found for this pane' }
                } else {
                    $acc = [MWW]::GetAccessible([IntPtr]$script:best)
                    $lines = New-Object System.Collections.ArrayList
                    if ($null -ne $acc) {
                        $n = [MWW]::ListRowCount([IntPtr]$script:best)
                        for ($i = 0; $i -lt [Math]::Min($n, $limit); $i++) {
                            $t = ''
                            try { $t = [string]$acc.accName($i) } catch { }
                            if ($t) { [void]$lines.Add($t) }
                        }
                    }
                    $ok = $true
                    $data = [ordered]@{
                        pane  = $name
                        count = $lines.Count
                        lines = @($lines)
                        note  = $(if ($lines.Count -eq 0) { "the '$name' pane is empty - that is a clean result" } else { $null })
                    }
                }
            }

            # Close the IDE so a file-level code write can proceed. The write engine
            # refuses while the IDE holds the project, because the IDE's cached state
            # would overwrite an external edit.
            #
            # The PID is taken from the WINDOW, not from a process-name lookup:
            # process enumeration is unreliable in this environment and omits Mwt
            # entirely, which would make this report success while nothing closed.
            'close_ide' {
                if (-not (Get-IdeWindow)) {
                    $ok = $true; $data = @{ closed = $true; window_remaining = $false }
                } else {
                    $app = Connect-App
                    [void](Assert-StagedOpen $app 'close_ide')
                    $app.ActiveProject.Save()
                    # WM_CLOSE permits native save/modal handling; never kill the process.
                    [void][MWW]::PostMessage([IntPtr](Get-IdeWindow), 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
                    $deadline = (Get-Date).AddSeconds(15)
                    while ((Get-IdeWindow) -and (Get-Date) -lt $deadline) {
                        if (@(Get-IdeDialogs).Count -gt 0) { break }
                        Start-Sleep -Milliseconds 300
                    }
                    $still = [bool](Get-IdeWindow)
                    $ok = -not $still
                    $data = @{ closed = (-not $still); window_remaining = $still }
                    if ($still) { $err = 'IDE close is pending; inspect ide_state and resolve the native dialog before editing' }
                    if (-not $still) { $script:App = $null }
                }
            }

            # Capture the IDE window's OWN content.
            #
            # CopyFromScreen copies a screen REGION, so whatever window happens to
            # be stacked over the IDE is what lands in the PNG - a "screenshot of
            # the IDE" that shows an unrelated application. PrintWindow asks the
            # window to render itself into a DC and is occlusion-independent, so
            # it is tried first; a blank bitmap (measured on some builds) falls
            # back to a screen copy taken with the IDE foregrounded.
            'screenshot' {
                $out = [string]$req.path
                if ([string]::IsNullOrWhiteSpace($out)) { throw 'screenshot requires "path"' }
                $ideW = Get-IdeWindow
                if (-not $ideW) { throw 'no running MotionWorks IDE window to capture' }
                $ideW = [IntPtr]$ideW

                # A minimized or hidden window cannot be captured either way.
                if ([MWW]::IsIconic($ideW)) { [void][MWW]::ShowWindow($ideW, 9) }   # SW_RESTORE
                [void][MWW]::ShowWindow($ideW, 5)                                   # SW_SHOW
                [void][MWW]::BringWindowToTop($ideW)
                [void][MWW]::SetForegroundWindow($ideW)
                Start-Sleep -Milliseconds 350

                Add-Type -AssemblyName System.Drawing
                $rc = New-Object MWW+RECT
                if (-not [MWW]::GetWindowRect($ideW, [ref]$rc)) { throw 'GetWindowRect failed' }
                $w = $rc.Right - $rc.Left
                $h = $rc.Bottom - $rc.Top
                if ($w -le 0 -or $h -le 0) { throw "unusable window rect ${w}x${h}" }

                $dir = Split-Path -Parent $out
                if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }

                # True when every sampled pixel has the same colour, i.e. the
                # capture produced a flat image rather than the window.
                function Test-Blank([System.Drawing.Bitmap]$b) {
                    $first = $b.GetPixel(0, 0).ToArgb()
                    for ($y = 1; $y -lt 6; $y++) {
                        for ($x = 1; $x -lt 6; $x++) {
                            $px = [int]($b.Width * $x / 6); $py = [int]($b.Height * $y / 6)
                            if ($b.GetPixel($px, $py).ToArgb() -ne $first) { return $false }
                        }
                    }
                    return $true
                }

                $method = $null
                $bmp = New-Object System.Drawing.Bitmap $w, $h

                foreach ($flags in @(2, 0)) {          # PW_RENDERFULLCONTENT, then plain
                    if ($method) { break }
                    $g = [System.Drawing.Graphics]::FromImage($bmp)
                    $hdc = $g.GetHdc()
                    $rendered = $false
                    try { $rendered = [MWW]::PrintWindow($ideW, $hdc, [uint32]$flags) }
                    finally { $g.ReleaseHdc($hdc); $g.Dispose() }
                    if ($rendered -and -not (Test-Blank $bmp)) { $method = "printwindow($flags)" }
                }

                if (-not $method) {
                    $g = [System.Drawing.Graphics]::FromImage($bmp)
                    $g.CopyFromScreen($rc.Left, $rc.Top, 0, 0, (New-Object System.Drawing.Size $w, $h))
                    $g.Dispose()
                    $method = 'screen-region'
                }

                $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
                $bmp.Dispose()

                # Which route was taken is a diagnostic, so it goes to the log rather
                # than the response: the registered output schema for this tool is an
                # exact shape (additionalProperties: false) and a running DSH keeps
                # the schema it loaded, so an extra field fails output validation.
                Log "screenshot $out via $method (${w}x${h})"

                $ok = $true
                $data = [ordered]@{ path = $out; width = $w; height = $h }
            }

            default {
                throw "unknown verb '$verb' (allowed: ping, status, start_ide, open, close_ide, trial_state, dismiss_trial, ide_state, answer_dialog, pous, variables, compile_state, make, build, patch, worksheet, datatypes, output_windows, activate_output, command_id, command, feature_state, screenshot, read_output, save, stop)"
            }
        }

        if ($verb -in @('make', 'build', 'rebuild', 'patch', 'worksheet', 'datatypes')) {
            $app = Connect-App
            [void](Assert-StagedOpen $app $verb)

            $compiledBefore = [bool]$app.ActiveProject.IsCompiled
            $sw = [Diagnostics.Stopwatch]::StartNew()
            $accepted = $false; $lastErr = $null
            # A compile is refused while the compiler is busy ("Operation not
            # possible while compiler is running."), so retry rather than sleep a
            # fixed time.
            while ($sw.Elapsed.TotalSeconds -lt 120) {
                try {
                    if ($verb -eq 'rebuild') {
                        $cid = [int]$app.GetIdOfCommand('adeCmdBuildRebuildProject')
                        if ($cid -ne 36570) { throw 'This IDE does not expose the verified Rebuild command' }
                        $window = Get-IdeWindow
                        if (-not $window) { throw 'No IDE window for Rebuild' }
                        $accepted = [MWW]::PostMessage([IntPtr]$window, 0x0111, [IntPtr]$cid, [IntPtr]::Zero)
                        if (-not $accepted) { throw 'Rebuild menu request was not posted' }
                    } else { $app.ActiveProject.Compile($mode); $accepted = $true }
                    break
                }
                catch { $lastErr = $_.Exception.Message; Start-Sleep -Milliseconds 750 }
            }
            if (-not $accepted) { throw "Compile($mode) never accepted within 120s; last error: $lastErr" }

            # A cached IsCompiled=true is not proof that this request completed.
            # Only a false-to-true transition observed for this invocation settles it.
            $isCompiled = $false
            $observedPending = -not $compiledBefore
            $alreadyUpToDate = $false
            $settle = [Diagnostics.Stopwatch]::StartNew()
            $swPoll = [Diagnostics.Stopwatch]::StartNew()
            while ($swPoll.Elapsed.TotalSeconds -lt 90) {
                Start-Sleep -Milliseconds 400
                try {
                    $currentCompiled = [bool]$app.ActiveProject.IsCompiled
                    if (-not $currentCompiled) { $observedPending = $true }
                    if ($currentCompiled -and $observedPending) { $isCompiled = $true; break }
                    # A project that was ALREADY compiled and records no modification has nothing
                    # to compile, so IsCompiled never drops and the transition test above can never
                    # be satisfied: a successful no-op Make waited the full 90 seconds and reported
                    # "completion unverified" while the project was in fact compiled and unmodified.
                    # Holding the condition for two seconds separates a genuine no-op from the
                    # instant before a real compile flips the flag.
                    if ($currentCompiled -and $compiledBefore -and -not [bool]$app.ActiveProject.IsModified) {
                        if ($settle.Elapsed.TotalSeconds -ge 2) {
                            $isCompiled = $true; $alreadyUpToDate = $true; break
                        }
                    } else { $settle.Restart() }
                } catch { }
            }
            $settled = $isCompiled
            $stalled = -not $settled

            # Never restore disk files underneath the running IDE. An offline
            # transaction journal is the recovery source after a verified close.

            $ok = $true
            $data = [ordered]@{
                mode            = $verb
                compile_type    = $mode
                accepted        = $accepted
                settled         = $settled
                stalled         = $stalled
                is_compiled     = $isCompiled
                is_modified     = $(try { [bool]$app.ActiveProject.IsModified } catch { $null })
                elapsed_s       = [Math]::Round($sw.Elapsed.TotalSeconds, 1)
            }
        }
    }
    catch {
        $ok = $false
        $err = $_.Exception.Message
        # Before reporting a failure, find out whether the IDE is simply waiting for
        # a button press. The automation API goes quiet while a modal dialog is up,
        # so a bare failure reads as "the IDE has closed" - and the agent then
        # abandons a perfectly healthy IDE, or worse, relaunches it. Naming the
        # dialog here means EVERY failing tool call explains itself, with no
        # discipline required from the agent.
        try {
            $dlgs = @(Get-IdeDialogs)
            if ($dlgs.Count -gt 0) {
                $desc = ($dlgs | ForEach-Object {
                    $lbl = ($_.buttons | ForEach-Object { $_.label }) -join ', '
                    "dialog $($_.handle) says: `"$($_.message)`" [buttons: $lbl]"
                }) -join ' || '
                $err = "$err`n`nNOTE: the IDE is NOT closed. It is blocked by a modal dialog. $desc`nCall mw_ide_state to see it (if available), or mw_ide_dialog to answer it; otherwise answer it by hand and retry."
            }
        } catch { }
    }

    Write-Result $id $verb $ok $data $err
    Remove-Item -Force $reqPath -ErrorAction SilentlyContinue
    Log "res id=$id ok=$ok err=$err"
    Start-Sleep -Milliseconds 50
}
