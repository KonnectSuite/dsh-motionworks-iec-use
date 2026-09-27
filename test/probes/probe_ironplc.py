"""Can the plugin drive ironplcmcp.exe directly, as a subprocess?

ironplc is not just an MCP server this agent happens to have - it is a 12.7 MB standalone executable
at resources/mcp-servers/ironplc/bin/ironplcmcp.exe that speaks JSON-RPC over stdio and ships TwinCAT
standard libraries. If the plugin can launch it and call `check`, then a REAL IEC 61131-3 compiler
sits in front of the writer instead of the ~80-line regex heuristic in stlint.py.

This speaks the protocol by hand: initialize, then tools/call. No SDK, no dependency - which is the
point, because the plugin has to do the same thing from Python and cannot take on a Node or Python
MCP client.
"""
import json
import subprocess
import sys
from pathlib import Path

EXE = Path(r"C:\Users\KNPhu\AppData\Local\Programs\AryaAI\resources\mcp-servers\ironplc\bin\ironplcmcp.exe")

SOURCE_OK = """PROGRAM Main
VAR
    CamReady   : BOOL;
    CamTableID : UINT;
    iState     : INT;
END_VAR
    CamReady := TRUE;
    iState := iState + 1;
    CamTableID := UINT#42;
END_PROGRAM
"""

SOURCE_BAD = """PROGRAM Main
VAR
    CamReady   : BOOL;
    CamTableID : UINT;
END_VAR
    CamReady := CamTableID;
END_PROGRAM
"""


class Mcp:
    """A minimal MCP client: enough to initialize and call one tool."""

    def __init__(self, exe: Path, timeout: float = 60.0):
        self.proc = subprocess.Popen(
            [str(exe)],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, encoding="utf-8", bufsize=1,
        )
        self.next_id = 1
        self.timeout = timeout

    def _send(self, payload: dict) -> None:
        self.proc.stdin.write(json.dumps(payload) + "\n")
        self.proc.stdin.flush()

    def _read(self) -> dict | None:
        line = self.proc.stdout.readline()
        if not line:
            return None
        line = line.strip()
        if not line:
            return None
        try:
            return json.loads(line)
        except json.JSONDecodeError:
            return None

    def call(self, method: str, params: dict | None = None) -> dict:
        req = {"jsonrpc": "2.0", "id": self.next_id, "method": method}
        if params is not None:
            req["params"] = params
        self.next_id += 1
        self._send(req)
        while True:
            msg = self._read()
            if msg is None:
                raise RuntimeError("the server closed the pipe")
            if msg.get("id") == req["id"]:
                return msg

    def notify(self, method: str, params: dict | None = None) -> None:
        req = {"jsonrpc": "2.0", "method": method}
        if params is not None:
            req["params"] = params
        self._send(req)

    def close(self) -> None:
        try:
            self.proc.stdin.close()
        except Exception:
            pass
        try:
            self.proc.wait(timeout=5)
        except Exception:
            self.proc.kill()


def main() -> int:
    if not EXE.is_file():
        print(f"  not found: {EXE}")
        return 2
    print(f"  exe: {EXE.stat().st_size / 1024 / 1024:.1f} MB\n")

    client = Mcp(EXE)
    try:
        init = client.call("initialize", {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": {"name": "motionworks-probe", "version": "1"},
        })
        info = init.get("result", {}).get("serverInfo", {})
        print(f"  initialize -> {info.get('name')} {info.get('version')}")
        client.notify("notifications/initialized")

        tools = client.call("tools/list")
        names = [t["name"] for t in tools.get("result", {}).get("tools", [])]
        print(f"  tools: {', '.join(names)}\n")

        for label, src in (("valid ST", SOURCE_OK), ("BOOL := UINT", SOURCE_BAD)):
            res = client.call("tools/call", {
                "name": "check",
                "arguments": {"sources": [{"name": "main.st", "content": src}],
                              "options": {"dialect": "codesys"}},
            })
            content = res.get("result", {}).get("content", [])
            text = content[0].get("text", "") if content else json.dumps(res)[:200]
            print(f"  --- {label} ---")
            print(f"    {text[:300]}")
            print()
    finally:
        client.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
