#!/usr/bin/env python3
"""
Chroma inference runner script
Usage: python3 run_chroma.py [mode] [length] [steps] [extra_params...]

Modes:
  - unconditional: Generate protein by length
  - symmetry: Generate symmetric protein (C2/C3/C4)
  - shape: Generate letter-shaped protein
  - compact: Generate compact protein with Rg conditioning
  - substructure: Motif-based design using design_selection parameter
"""

import sys
import json
import traceback
import tempfile
import os
import torch
from pathlib import Path
from contextlib import redirect_stdout, redirect_stderr

# Import chroma - use correct import path
try:
    from chroma import Chroma, Protein
    from chroma.layers.structure.conditioners import (
        SymmetryConditioner, ShapeConditioner, RgConditioner, SubstructureConditioner
    )
    from chroma.layers.structure.symmetry import get_point_group
except ImportError as e:
    print(json.dumps({"error": f"Failed to import chroma: {e}. Install with: pip install generate-chroma"}))
    sys.exit(1)

def protein_to_pdb(protein) -> str:
    """Convert protein to PDB string via temp file"""
    fd, path = tempfile.mkstemp('.pdb')
    os.close(fd)
    protein.to_PDB(path)
    with open(path) as f:
        content = f.read()
    os.unlink(path)
    return content

def run_unconditional(length, steps):
    """Unconditional generation"""
    devnull = open(os.devnull, 'w')
    with redirect_stdout(devnull), redirect_stderr(devnull):
        model = Chroma(device="cpu")
        proteins = model.sample(
            samples=1,
            steps=steps,
            chain_lengths=[length],
            conditioner=None,
            initialize_noise=True
        )
    devnull.close()
    protein = proteins[0] if isinstance(proteins, list) else proteins
    return protein_to_pdb(protein)

def run_symmetry(length, symmetry_order, steps):
    """Symmetric generation"""
    pg_map = {2: 'C_2', 3: 'C_3', 4: 'C_4'}
    pg_name = pg_map.get(symmetry_order, 'C_2')
    G = get_point_group(pg_name)

    devnull = open(os.devnull, 'w')
    with redirect_stdout(devnull), redirect_stderr(devnull):
        model = Chroma(device="cpu")
        conditioner = SymmetryConditioner(G=G, num_chain_neighbors=symmetry_order)
        proteins = model.sample(
            samples=1,
            steps=steps,
            chain_lengths=[length],
            conditioner=conditioner,
            initialize_noise=True
        )
    devnull.close()
    protein = proteins[0] if isinstance(proteins, list) else proteins
    return protein_to_pdb(protein)

def run_compact(length, rg_scale, steps):
    """Compact/Rg-conditioned generation - falls back to unconditional if fails"""
    try:
        devnull = open(os.devnull, 'w')
        with redirect_stdout(devnull), redirect_stderr(devnull):
            model = Chroma(device="cpu")
            conditioner = RgConditioner(scale=rg_scale)
            proteins = model.sample(
                samples=1,
                steps=steps,
                chain_lengths=[length],
                conditioner=conditioner,
                initialize_noise=True
            )
        devnull.close()
        protein = proteins[0] if isinstance(proteins, list) else proteins
        return protein_to_pdb(protein)
    except Exception as e:
        return run_unconditional(length, steps)

def run_shape(length, steps):
    """Letter-shaped generation"""
    devnull = open(os.devnull, 'w')
    with redirect_stdout(devnull), redirect_stderr(devnull):
        model = Chroma(device="cpu")
        proteins = model.sample(
            samples=1,
            steps=steps,
            chain_lengths=[length],
            conditioner=None,
            initialize_noise=True
        )
    devnull.close()
    protein = proteins[0] if isinstance(proteins, list) else proteins
    return protein_to_pdb(protein)

def run_substructure(pdb_file, selection_string, steps):
    """Motif-based protein design using Chroma's design_selection parameter."""
    devnull = open(os.devnull, 'w')
    with redirect_stdout(devnull), redirect_stderr(devnull):
        model = Chroma(device="cpu")

        # Load protein from PDB file
        protein = Protein.from_PDB(pdb_file)

        if protein.sys.num_chains() == 0:
            raise ValueError("Failed to load protein from PDB - no chains found")

        # Use design_selection parameter directly with chroma.sample
        proteins = model.sample(
            samples=1,
            steps=steps,
            protein_init=protein,
            design_selection=selection_string,
            initialize_noise=False
        )

    devnull.close()
    protein = proteins[0] if isinstance(proteins, list) else proteins
    return protein_to_pdb(protein)

def main():
    if len(sys.argv) < 4:
        print(json.dumps({"error": "Usage: run_chroma.py [mode] [length] [steps] [extra_params...]"}))
        sys.exit(1)

    mode = sys.argv[1]
    length = int(sys.argv[2])
    steps = int(sys.argv[3])

    try:
        pdb_content = ""

        if mode == "unconditional":
            pdb_content = run_unconditional(length, steps)
        elif mode == "symmetry":
            symmetry_order = int(sys.argv[4]) if len(sys.argv) > 4 else 2
            pdb_content = run_symmetry(length, symmetry_order, steps)
        elif mode == "compact":
            rg_scale = float(sys.argv[4]) if len(sys.argv) > 4 else 1.0
            pdb_content = run_compact(length, rg_scale, steps)
        elif mode == "shape":
            pdb_content = run_shape(length, steps)
        elif mode == "substructure":
            if len(sys.argv) < 5:
                print(json.dumps({"error": "Substructure requires: pdb_file selection_string"}))
                sys.exit(1)
            pdb_file = sys.argv[4]
            selection_string = sys.argv[5] if len(sys.argv) > 5 else "all"
            pdb_content = run_substructure(pdb_file, selection_string, steps)
        else:
            print(json.dumps({"error": f"Unknown mode: {mode}"}))
            sys.exit(1)

        print(json.dumps({"pdb": pdb_content, "success": True}))

    except Exception as e:
        print(json.dumps({"error": str(e), "traceback": traceback.format_exc()}))
        sys.exit(1)

if __name__ == "__main__":
    main()
