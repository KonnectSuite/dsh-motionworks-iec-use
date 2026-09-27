# Enumerate the six ImportExports operations. The collection is 1-BASED - index 0 is out of
# range - and each item carries a Direction and an ImportExportType, which says which one is the
# PLCopen XML export and which is the import. Execute is the method this plugin has been missing:
# if it takes arguments, an export and an import can be driven from COM, and an IMPORT is what
# would let a task's pouInstance list be rewritten from outside the IDE.
$ErrorActionPreference = 'Continue'

$app = New-Object -ComObject Ade.Application.550
$ie = $app.ImportExports

"  count: $($ie.Count)"
""
for ($i = 1; $i -le $ie.Count; $i++) {
    "  ===== item $i ====="
    try {
        $item = $ie.Item($i)
    } catch {
        "    Item($i) failed: $($_.Exception.Message)"
        continue
    }
    foreach ($prop in @('Direction', 'ImportExportType', 'Name', 'Description')) {
        try {
            $v = $item.$prop
            if ($null -ne $v) { "    $prop = $v" }
        } catch { }
    }
    try {
        $attrs = $item.Attributes
        $n = 0
        foreach ($a in $attrs) {
            $n++
            "    attribute ${n}: $a"
            if ($n -ge 12) { break }
        }
        if ($n -eq 0) { "    (no attributes)" }
    } catch { "    Attributes: $($_.Exception.Message)" }
    $exec = $item | Get-Member -Name Execute -EA SilentlyContinue
    if ($exec) { "    Execute -> $($exec.Definition)" }
    ""
}

"  === can an export actually be triggered? try Execute with no arguments ==="
for ($i = 1; $i -le $ie.Count; $i++) {
    $item = $ie.Item($i)
    $dir = ''
    try { $dir = $item.Direction } catch { }
    "  --- item $i (Direction=$dir) ---"
    try {
        $r = $item.Execute()
        "      Execute() returned: $r"
    } catch {
        "      Execute() failed: $($_.Exception.Message)"
    }
}
