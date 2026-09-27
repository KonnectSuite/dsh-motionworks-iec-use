<#
  MotionWorks Use - modal-dialog watcher.

  WHY THIS IS A SEPARATE PROCESS
  ------------------------------
  OpenProject is a synchronous out-of-process COM call. When MotionWorks raises a
  prompt *during* the load - "this project was not closed cleanly, load anyway?",
  "defragment?" - the server enters a modal loop and the call does not return until
  that prompt is answered. The bridge thread is therefore BLOCKED by definition and
  cannot answer it; no retry, no timeout, no catch. Measured: an open call sat for
  minutes with the request logged and no response.

  So the answering has to happen on another thread, and in PowerShell that means
  another process. The bridge starts this watcher immediately before OpenProject and
  kills it afterwards; in between it presses the obvious answer on any known prompt.

  SAFETY
  ------
  Only ever touches prompts raised by the MotionWorks IDE process, and only presses
  buttons from a fixed list of obviously-safe answers about a STAGED COPY - the
  plugin never opens the user's original project. Anything unrecognised is left
  completely alone.
#>
param(
    [int]$Seconds = 150,
    [int]$PollMs = 400
)

$ErrorActionPreference = 'Continue'

Add-Type -TypeDefinition @'
using System; using System.Text; using System.Runtime.InteropServices;
public class WDW {
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr p, EnumWindowsProc cb, IntPtr l);
  public delegate bool EnumWindowsProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetClassNameW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetDlgCtrlID(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
  [DllImport("user32.dll", EntryPoint="SendMessageTimeoutW", CharSet=CharSet.Unicode)]
  public static extern IntPtr SendTimeoutStr(IntPtr h, uint msg, IntPtr wp, StringBuilder lp, uint flags, uint ms, out IntPtr res);
  [DllImport("user32.dll", EntryPoint="SendMessageTimeoutW", CharSet=CharSet.Unicode)]
  public static extern IntPtr SendTimeoutInt(IntPtr h, uint msg, IntPtr wp, IntPtr lp, uint flags, uint ms, out IntPtr res);

  const uint SMTO_ABORTIFHUNG = 0x0002;

  public static string ReadText(IntPtr h) {
    IntPtr r;
    if (SendTimeoutInt(h, 0x000E, IntPtr.Zero, IntPtr.Zero, SMTO_ABORTIFHUNG, 150, out r) == IntPtr.Zero) return "";
    int n = r.ToInt32(); if (n <= 0) return ""; if (n > 32768) n = 32768;
    StringBuilder sb = new StringBuilder(n + 2);
    if (SendTimeoutStr(h, 0x000D, (IntPtr)(n + 1), sb, SMTO_ABORTIFHUNG, 150, out r) == IntPtr.Zero) return "";
    return sb.ToString();
  }

  public static bool Click(IntPtr h) {
    IntPtr r;
    return SendTimeoutInt(h, 0x00F5, IntPtr.Zero, IntPtr.Zero, SMTO_ABORTIFHUNG, 1500, out r) != IntPtr.Zero;
  }
}
'@

# Prompts with one obviously-safe answer. These are questions about a staged COPY,
# so the answer cannot endanger real work. Anything absent from this table is left
# strictly alone - the watcher never guesses.
$known = @(
    @{ match = 'defragment';                                button = 'No'  },
    @{ match = 'would you like to load the project anyway';  button = 'Yes' },
    @{ match = 'currently loaded by';                       button = 'Yes' },
    @{ match = 'abnormal termination';                      button = 'Yes' },
    @{ match = 'disabled/enabled by software key';          button = 'OK'  },
    @{ match = 'project is currently loaded';               button = 'Yes' }
)

$deadline = (Get-Date).AddSeconds($Seconds)
$answeredCount = 0

while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds $PollMs

    # IDE pid, taken from the IDE window (never from a process-name lookup).
    $script:idePid = 0
    $cbIde = [WDW+EnumWindowsProc]{
        param($h, $l)
        $t = New-Object System.Text.StringBuilder 256
        [void][WDW]::GetWindowTextW($h, $t, 256)
        $title = $t.ToString()
        if ([WDW]::IsWindowVisible($h) -and ($title -like 'MotionWorks IEC 3 Pro*' -or $title -like 'MULTIPROG*')) {
            $p = [uint32]0; [void][WDW]::GetWindowThreadProcessId($h, [ref]$p)
            $script:idePid = [int]$p
        }
        return $true
    }
    [void][WDW]::EnumWindows($cbIde, [IntPtr]::Zero)
    if ($script:idePid -eq 0) { continue }

    $script:hits = New-Object System.Collections.ArrayList
    $cbDlg = [WDW+EnumWindowsProc]{
        param($h, $l)
        if (-not [WDW]::IsWindowVisible($h)) { return $true }
        $p = [uint32]0; [void][WDW]::GetWindowThreadProcessId($h, [ref]$p)
        if ([int]$p -ne $script:idePid) { return $true }
        $c = New-Object System.Text.StringBuilder 64
        [void][WDW]::GetClassNameW($h, $c, 64)
        if ($c.ToString() -ne '#32770') { return $true }

        $script:btnHandles = @{}
        $texts = New-Object System.Collections.ArrayList
        $cbKid = [WDW+EnumWindowsProc]{
            param($k, $l2)
            if (-not [WDW]::IsWindowVisible($k)) { return $true }
            $kc = New-Object System.Text.StringBuilder 64
            [void][WDW]::GetClassNameW($k, $kc, 64)
            $cn = $kc.ToString()
            if ($cn -ne 'Button' -and $cn -ne 'Static') { return $true }
            $txt = [WDW]::ReadText($k)
            if (-not $txt) { return $true }
            if ($cn -eq 'Button') {
                # Strip the accelerator marker to get the plain label. NB: a named
                # regex group does NOT become a variable in PowerShell - it lives in
                # $Matches - so the earlier `-match '^(?<lbl>.+)$'` form silently
                # keyed every button on the empty string, the lookup never matched,
                # and the watcher sat there answering nothing while the IDE stayed
                # blocked. Verified by instrumenting it: message read fine, buttons
                # dictionary empty.
                $label = ($txt.Trim() -replace '&', '')
                if ($label) { $script:btnHandles[$label] = $k }
            } else { [void]$texts.Add($txt.Trim()) }
            return $true
        }
        [void][WDW]::EnumChildWindows($h, $cbKid, [IntPtr]::Zero)
        [void]$script:hits.Add([pscustomobject]@{
            HWND    = $h
            Message = (($texts | Select-Object -Unique) -join "`n")
            Buttons = $script:btnHandles
        })
        return $true
    }
    [void][WDW]::EnumWindows($cbDlg, [IntPtr]::Zero)

    foreach ($d in $script:hits) {
        $hay = $d.Message.ToLower()
        foreach ($k in $known) {
            if ($hay -notlike "*$($k.match)*") { continue }
            $target = $null
            foreach ($lbl in $d.Buttons.Keys) { if ($lbl -ieq $k.button) { $target = $d.Buttons[$lbl]; break } }
            if ($target -and [WDW]::Click($target)) { $answeredCount++ }
            break
        }
    }
}
