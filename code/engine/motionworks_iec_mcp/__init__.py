"""MCP server for offline Yaskawa MotionWorks IEC 3 Pro project work.

The package is layered so that the dangerous parts stay in one place:

    cfb          - OLE/CFB reader + writer primitives (no MotionWorks knowledge)
    project      - project/expanded-directory resolution and inventory
    variables    - merged view of the .VB text and .VGR binary variable stores
    errors       - typed failures that surface as readable tool errors
    server       - FastMCP tool registration (Tier 1 read-only, Tier 2 writes)

Tier 1 tools are read-only and safe to use while MotionWorks IEC is open.
Tier 2 tools mutate the project and require MotionWorks to be closed.
"""

__version__ = "0.1.0"
