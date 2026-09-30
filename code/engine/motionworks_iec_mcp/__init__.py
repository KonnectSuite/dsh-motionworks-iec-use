"""File engine behind the MotionWorks plugin.

The package is layered so that the dangerous parts stay in one place:

    cfb          - OLE/CFB reader + writer primitives (no MotionWorks knowledge)
    project      - project/expanded-directory resolution and inventory
    variables    - merged view of the .VB text and .VGR binary variable stores
    errors       - typed failures that surface as readable tool errors
    staging      - refuses anything that is not a proven staged copy

The plugin in index.js is the tool surface. Writes go through mw_code.py.
"""

__version__ = "0.1.0"
