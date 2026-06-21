#!/usr/bin/env python3
"""
Build script to package the Python backend as a standalone executable using PyInstaller.
Run this script on the target platform (macOS or Windows) before building the Electron app.

Usage:
    python3 build-backend.py

This will create a standalone executable in the dist-backend/ directory.
"""

import subprocess
import sys
import os
import shutil

BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
SERVER_DIR = os.path.join(BACKEND_DIR, 'server')
DIST_DIR = os.path.join(BACKEND_DIR, 'dist-backend')

def build_backend():
    # Clean previous build
    if os.path.exists(DIST_DIR):
        shutil.rmtree(DIST_DIR)
    os.makedirs(DIST_DIR)

    # PyInstaller command to create a single-file executable
    cmd = [
        sys.executable, '-m', 'PyInstaller',
        '--name', 'ProteinDesignBackend',
        '--onefile',
        '--onedir',
        '--add-data', f'{SERVER_DIR}{os.pathsep}server',
        '--hidden-import', 'fastapi',
        '--hidden-import', 'uvicorn',
        '--hidden-import', 'uvicorn.logging',
        '--hidden-import', 'uvicorn.loops',
        '--hidden-import', 'uvicorn.loops.auto',
        '--hidden-import', 'uvicorn.protocols',
        '--hidden-import', 'uvicorn.protocols.http',
        '--hidden-import', 'uvicorn.protocols.http.auto',
        '--hidden-import', 'uvicorn.protocols.websockets',
        '--hidden-import', 'uvicorn.protocols.websockets.auto',
        '--hidden-import', 'uvicorn.lifespan',
        '--hidden-import', 'uvicorn.lifespan.on',
        '--hidden-import', 'httpx',
        '--hidden-import', 'pydantic',
        '--hidden-import', 'starlette',
        '--hidden-import', 'starlette.middleware',
        '--hidden-import', 'starlette.middleware.cors',
        '--hidden-import', 'starlette.responses',
        '--hidden-import', 'starlette.routing',
        '--hidden-import', 'anyio',
        '--hidden-import', 'numpy',
        '--collect-all', '3dmol',
        '--workpath', os.path.join(DIST_DIR, 'build'),
        '--distpath', DIST_DIR,
        os.path.join(SERVER_DIR, 'main.py'),
    ]

    print(f"Running: {' '.join(cmd[:5])} ...")
    result = subprocess.run(cmd, cwd=BACKEND_DIR)

    if result.returncode != 0:
        print("Build failed!")
        sys.exit(1)

    # Find the executable
    if sys.platform == 'win32':
        exe_path = os.path.join(DIST_DIR, 'ProteinDesignBackend.exe')
    else:
        exe_path = os.path.join(DIST_DIR, 'ProteinDesignBackend')

    if os.path.exists(exe_path):
        print(f"Build successful: {exe_path}")
        print(f"Size: {os.path.getsize(exe_path) / 1024 / 1024:.1f} MB")
    else:
        print("Executable not found!")
        # List contents of dist-backend
        if os.path.exists(DIST_DIR):
            print(f"Contents of {DIST_DIR}:")
            for item in os.listdir(DIST_DIR):
                print(f"  {item}")
        sys.exit(1)

if __name__ == '__main__':
    build_backend()
