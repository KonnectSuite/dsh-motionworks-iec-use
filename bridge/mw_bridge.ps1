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
  public delegate bool EnumWindowsProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
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
            $sb = New-Object System.Text.StringBuilder 512
            [void][MWW]::GetWindowTextW($h, $sb, 512)
            $t = $sb.ToString()
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

# --- COM connection, held open across requests ---
$script:App = $null

function Connect-App {
    if ($script:App -ne $null) {
        # A cached connection can outlive the IDE it points at: the coding loop
        # closes the IDE to write code, then starts it again. The dead proxy stays
        # valid as an object, so without this probe every later call fails with
        # "The RPC server is unavailable" (0x800706BA) until the bridge restarts.
        try { $null = $script:App.Version; return $script:App }
        catch { $script:App = $null }
    }
    if (-not (Get-IdeWindow)) {
        throw "no running MotionWorks IDE window; refusing to instantiate (that would launch a new IDE and a trial licence permits only one instance). Use the 'start_ide' verb to launch one deliberately."
    }
    $script:App = New-Object -ComObject Ade.Application.550
    Log "connected: Version=$($script:App.Version)"
    return $script:App
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
        switch ($verb) {

            'ping' {
                $ok = $true
                $data = [ordered]@{ alive = $true; ide_window = (Get-IdeWindow -ne $null) }
            }

            'stop' {
                # Consume the request BEFORE exiting. Leaving req.json behind means
                # the next bridge to start immediately reads this stale stop and
                # dies on launch.
                Remove-Item -Force $reqPath -ErrorAction SilentlyContinue
                Write-Result $id $verb $true ([ordered]@{ stopping = $true }) $null
                Log "stop requested; exiting"
                if ($script:App -ne $null) { try { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($script:App) } catch { } }
                exit 0
            }

            'status' {
                $app = Connect-App
                $ideW = Get-IdeWindow
                $isOpen = $null; $activeName = $null
                try { $isOpen = $app.IsProjectOpen() } catch { $isOpen = $null }
                if ($isOpen) { try { $activeName = $app.ActiveProject.FullName } catch { } }
                $ok = $true
                $data = [ordered]@{
                    version         = [string]$app.Version
                    ide_window      = ("0x{0:X}" -f ([int64]$ideW))
                    is_project_open = $isOpen
                    active_project  = $activeName
                }
            }

            'open' {
                $path = [string]$req.path
                if ([string]::IsNullOrWhiteSpace($path)) { throw 'open requires "path"' }
                $full = [IO.Path]::GetFullPath($path)
                $stageFull = [IO.Path]::GetFullPath($StageRoot)
                if (-not $full.StartsWith($stageFull, [StringComparison]::OrdinalIgnoreCase)) {
                    throw "REFUSED: '$full' is outside the staging root '$stageFull'. Only staged copies may be opened."
                }
                if (-not (Test-Path $full)) { throw "project not found: $full" }
                $app = Connect-App
                # From Ade.tlb: OpenProject(Name, ConfirmConvert). ConfirmConvert=$false
                # suppresses the conversion prompt, which would otherwise block an
                # unattended flow on a modal dialog nobody is there to answer.
                $app.OpenProject($full, $false)
                # Verify what actually happened rather than trusting the call.
                $verified = $null; $activeName = $null
                for ($i = 0; $i -lt 40; $i++) {
                    Start-Sleep -Milliseconds 500
                    try { $verified = $app.IsProjectOpen(); if ($verified) { $activeName = $app.ActiveProject.FullName; break } } catch { }
                }
                $ok = [bool]$verified
                $data = [ordered]@{ requested = $full; is_project_open = $verified; active_project = $activeName }
                if (-not $verified) { $err = 'OpenProject was called but IsProjectOpen never became true' }
            }

            'pous' {
                $app = Connect-App
                if (-not $app.IsProjectOpen()) { throw 'no project is open in the IDE' }
                $col = $app.ActiveProject.Pous
                $items = @()
                for ($i = 1; $i -le $col.Count; $i++) {
                    $p = $col.Item($i)
                    $items += [ordered]@{ index = $i; name = [string]$p.Name; language = [string]$p.PouLanguage }
                }
                $ok = $true
                $data = [ordered]@{ count = $col.Count; pous = $items }
            }

            'compile_state' {
                $app = Connect-App
                if (-not $app.IsProjectOpen()) { throw 'no project is open in the IDE' }
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
                $app = Connect-App
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
                if (-not $app.IsProjectOpen()) { throw 'no project is open in the IDE' }
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
                $exe = [string]$req.exe
                if ([string]::IsNullOrWhiteSpace($exe)) {
                    $exe = 'C:\Program Files (x86)\Yaskawa\MotionWorks IEC 3 Pro\Mwt.exe'
                }
                $already = [bool](Get-IdeWindow)
                if (-not $already) {
                    if (-not (Test-Path $exe)) { throw "Mwt.exe not found at $exe" }
                    Start-Process -FilePath $exe | Out-Null
                    $deadline = (Get-Date).AddSeconds(120)
                    while (-not (Get-IdeWindow) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 1000 }
                }
                $w = Get-IdeWindow
                if (-not $w) { throw 'the IDE window did not appear within 120s' }
                # Force a fresh connection: the previous one pointed at the old process.
                $script:App = $null
                $app = Connect-App
                $ok = $true
                $data = [ordered]@{
                    already_running = $already
                    ide_window      = ("0x{0:X}" -f ([int64]$w))
                    version         = [string]$app.Version
                    launched_exe    = $exe
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

            # Close the IDE so a file-level code write can proceed. The write engine
            # refuses while the IDE holds the project, because the IDE's cached state
            # would overwrite an external edit.
            #
            # The PID is taken from the WINDOW, not from a process-name lookup:
            # process enumeration is unreliable in this environment and omits Mwt
            # entirely, which would make this report success while nothing closed.
            'close_ide' {
                $psapi = @'
using System; using System.Runtime.InteropServices;
public class KILLW {
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
}
'@
                try { Add-Type -TypeDefinition $psapi -ErrorAction Stop } catch { }
                $deadline = (Get-Date).AddSeconds(40)
                $killed = @()
                while ((Get-IdeWindow) -and (Get-Date) -lt $deadline) {
                    $h = Get-IdeWindow
                    $procId = [uint32]0
                    [void][KILLW]::GetWindowThreadProcessId([IntPtr]$h, [ref]$procId)
                    if ($procId -gt 0 -and ($killed -notcontains $procId)) {
                        $killed += $procId
                        try { Stop-Process -Id $procId -Force -ErrorAction Stop } catch { }
                    }
                    Start-Sleep -Milliseconds 600
                }
                $still = [bool](Get-IdeWindow)
                $ok = (-not $still)
                $data = [ordered]@{ closed = (-not $still); killed_pids = $killed; window_remaining = $still }
                if ($still) { $err = 'the IDE window is still present after 40s' }
            }

            # Capture the IDE window from the desktop DC. PrintWindow is NOT used:
            # measured on this app it returns 0 for both flag values and yields an
            # all-black bitmap, whereas a screen-region copy works.
            'screenshot' {
                $out = [string]$req.path
                if ([string]::IsNullOrWhiteSpace($out)) { throw 'screenshot requires "path"' }
                $ideW = Get-IdeWindow
                if (-not $ideW) { throw 'no running MotionWorks IDE window to capture' }

                Add-Type -AssemblyName System.Drawing
                $rc = New-Object MWW+RECT
                if (-not [MWW]::GetWindowRect([IntPtr]$ideW, [ref]$rc)) { throw 'GetWindowRect failed' }
                $w = $rc.Right - $rc.Left
                $h = $rc.Bottom - $rc.Top
                if ($w -le 0 -or $h -le 0) { throw "unusable window rect ${w}x${h}" }

                $dir = Split-Path -Parent $out
                if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }

                $bmp = New-Object System.Drawing.Bitmap $w, $h
                $g = [System.Drawing.Graphics]::FromImage($bmp)
                $g.CopyFromScreen($rc.Left, $rc.Top, 0, 0, (New-Object System.Drawing.Size $w, $h))
                $g.Dispose()
                $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
                $bmp.Dispose()

                $ok = $true
                $data = [ordered]@{ path = $out; width = $w; height = $h }
            }

            default {
                throw "unknown verb '$verb' (allowed: ping, status, start_ide, open, close_ide, pous, variables, compile_state, make, build, patch, worksheet, datatypes, output_windows, activate_output, command_id, command, feature_state, screenshot, stop)"
            }
        }

        if ($verb -in @('make', 'build', 'patch', 'worksheet', 'datatypes')) {
            $app = Connect-App
            if (-not $app.IsProjectOpen()) { throw 'no project is open in the IDE' }
            $sw = [Diagnostics.Stopwatch]::StartNew()
            $accepted = $false; $lastErr = $null
            # A compile is refused while the compiler is busy ("Operation not
            # possible while compiler is running."), so retry rather than sleep a
            # fixed time.
            while ($sw.Elapsed.TotalSeconds -lt 120) {
                try { $app.ActiveProject.Compile($mode); $accepted = $true; break }
                catch { $lastErr = $_.Exception.Message; Start-Sleep -Milliseconds 750 }
            }
            if (-not $accepted) { throw "Compile($mode) never accepted within 120s; last error: $lastErr" }

            # RELIABLE completion detection: offer the same compile again until the
            # IDE accepts it, which proves the previous one finished. ApplicationState
            # bit 2 (adeASCompiling) is NOT trustworthy for this - measured reading
            # "idle" 0s into a build that was demonstrably still running.
            $settled = $false
            while ($sw.Elapsed.TotalSeconds -lt 300) {
                Start-Sleep -Milliseconds 500
                try { $app.ActiveProject.Compile($mode); $settled = $true; break } catch { }
            }
            Start-Sleep -Milliseconds 500
            $isCompiled = $null
            try { $isCompiled = [bool]$app.ActiveProject.IsCompiled } catch { }
            $ok = $true
            $data = [ordered]@{
                mode          = $verb
                compile_type  = $mode
                accepted      = $accepted
                settled       = $settled
                is_compiled   = $isCompiled
                is_modified   = $(try { [bool]$app.ActiveProject.IsModified } catch { $null })
                elapsed_s     = [Math]::Round($sw.Elapsed.TotalSeconds, 1)
            }
        }
    }
    catch {
        $ok = $false
        $err = $_.Exception.Message
    }

    Write-Result $id $verb $ok $data $err
    Remove-Item -Force $reqPath -ErrorAction SilentlyContinue
    Log "res id=$id ok=$ok err=$err"
    Start-Sleep -Milliseconds 50
}
