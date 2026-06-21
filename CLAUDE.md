# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Protein Design Studio is an Electron desktop application for computational protein design using Chroma, ProteinMPNN, and ESMFold. It provides a modular workflow for backbone generation, sequence design, and structure prediction.

## Architecture

```
protein-design/
├── electron/          # Electron main process
│   ├── main.ts        # Main entry, window management
│   ├── preload.ts     # Context bridge
│   └── server.ts      # Backend process manager
├── server/            # FastAPI backend
│   └── main.py        # API endpoints, tool integration
├── src/               # React frontend
│   ├── components/     # UI components
│   ├── App.tsx        # Main app with state
│   └── index.css      # Global styles
├── dist/              # Built frontend
└── dist-electron/      # Built electron
```

## Common Commands

```bash
npm run dev              # Start dev server (frontend + backend)
npm run build            # Build for production
npm run electron:build:mac   # Build macOS dmg
npm run electron:build:win    # Build Windows exe
```

## Backend API

The FastAPI server runs on `http://localhost:8000`:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/api/pdb/fetch` | POST | Fetch PDB from RCSB |
| `/api/chroma/design` | POST | Chroma unconditional generation |
| `/api/chroma/symmetry` | POST | Chroma symmetric design |
| `/api/chroma/shape` | POST | Chroma letter-shaped design |
| `/api/chroma/compact` | POST | Chroma compact design |
| `/api/chroma/substructure` | POST | Chroma motif-based design |
| `/api/proteinmpnn/design` | POST | ProteinMPNN sequence design |
| `/api/esmfold/predict` | POST | ESMFold structure prediction |
| `/api/rmsd/calculate` | POST | RMSD calculation |

## Tool Integration

Currently all tool endpoints use mock implementations that generate simulated data. To integrate real tools:

1. **Chroma**: Uses local conda environment at `~/.protein-design/envs/chroma`
2. **ProteinMPNN**: Uses local installation at `~/ProteinMPNN`
3. **ESMFold**: Uses remote API at `https://api.esmatlas.com`

## Development Notes

- 3Dmol.js version 2.5.4 is used for protein visualization
- Electron main process manages the Python backend as a subprocess
- State is managed via React useState in App.tsx
- All API calls go to the FastAPI backend on port 8000