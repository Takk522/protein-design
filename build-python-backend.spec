# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller spec file to bundle Python backend for Windows
Creates a standalone executable containing:
- Python runtime
- FastAPI, uvicorn, httpx, pydantic
- Chroma and ProteinMPNN scripts
"""

import sys
import os

block_cipher = None

# Paths - adjust these for your environment
ANACONDA_PATH = os.path.expanduser("~/anaconda3")
CHROMA_ENV = os.path.join(ANACONDA_PATH, "envs", "chroma")
PROTEINMPNN_PATH = os.path.expanduser("~/ProteinMPNN")

a = Analysis(
    ['server/main.py'],
    pathex=[os.path.dirname(os.path.abspath(__file__))],
    binaries=[],
    datas=[
        # Include run_chroma.py
        ('server/run_chroma.py', 'server'),
        # Include run_proteinmpnn.py
        ('server/run_proteinmpnn.py', 'server'),
        # Include ProteinMPNN folder
        (PROTEINMPNN_PATH, 'ProteinMPNN'),
    ],
    hiddenimports=[
        'fastapi',
        'uvicorn',
        'uvicorn.logging',
        'uvicorn.loops',
        'uvicorn.loops.auto',
        'uvicorn.protocols',
        'uvicorn.protocols.http',
        'uvicorn.protocols.http.auto',
        'uvicorn.protocols.websockets',
        'uvicorn.protocols.websockets.auto',
        'uvicorn.lifespan',
        'uvicorn.lifespan.on',
        'httpx',
        'pydantic',
        'starlette',
        'numpy',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='ProteinDesignBackend',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,  # No console window
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
