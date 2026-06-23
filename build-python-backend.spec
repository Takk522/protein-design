# -*- mode: python ; coding: utf-8 -*-
import sys
import os
import inspect
from PyInstaller.utils.hooks import collect_all, collect_submodules

block_cipher = None

# Get absolute paths
CURRENT_DIR = os.path.dirname(os.path.abspath(inspect.getfile(inspect.currentframe())))
PROJECT_ROOT = os.getcwd()
PROTEINMPNN_PATH = os.path.join(PROJECT_ROOT, 'ProteinMPNN')

# Collect numpy and sklearn with all binaries to avoid ABI issues
numpy_binaries = collect_all('numpy')
sklearn_binaries = collect_all('sklearn')

a = Analysis(
    ['server/main.py'],
    pathex=[PROJECT_ROOT],
    binaries=numpy_binaries[0] + sklearn_binaries[0],
    datas=[
        ('server/run_chroma.py', 'server'),
        ('server/run_proteinmpnn.py', 'server'),
        (PROTEINMPNN_PATH, 'ProteinMPNN'),
    ] + numpy_binaries[1] + sklearn_binaries[1],
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
        'sklearn',
        'chroma',
        'chroma.api',
        'chroma.layers',
        'chroma.layers.structure',
        'chroma.layers.structure.conditioners',
        'chroma.layers.structure.symmetry',
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
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
