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
    from chroma import api
    from chroma import Chroma, Protein
    from chroma import conditioners
    from chroma.layers.structure.conditioners import (
        SymmetryConditioner, ShapeConditioner, RgConditioner, SubstructureConditioner
    )
    from chroma.layers.structure.symmetry import get_point_group
except ImportError as e:
    print(json.dumps({"error": f"Failed to import chroma: {e}. Install with: pip install generate-chroma"}))
    sys.exit(1)

# Register API key - get from environment or use default
# Note: For production, get your own key from https://generatebio.com/chroma
API_KEY = os.environ.get('CHROMA_API_KEY', 'e424a1b4a1604a3a8cc83f0792dc3253')
try:
    api.register_key(API_KEY)
except Exception as e:
    print(json.dumps({"error": f"Failed to register API key: {e}"}))
    # Continue anyway - key might already be registered

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
        model = Chroma()
        proteins = model.sample(
            chain_lengths=[length],
            steps=steps,
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
        model = Chroma()
        conditioner = conditioners.SymmetryConditioner(G=G, num_chain_neighbors=symmetry_order)
        proteins = model.sample(
            chain_lengths=[length],
            conditioner=conditioner,
            steps=steps,
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
            model = Chroma()
            conditioner = conditioners.RgConditioner(scale=rg_scale)
            proteins = model.sample(
                chain_lengths=[length],
                conditioner=conditioner,
                steps=steps,
                initialize_noise=True
            )
        devnull.close()
        protein = proteins[0] if isinstance(proteins, list) else proteins
        return protein_to_pdb(protein)
    except Exception as e:
        return run_unconditional(length, steps)

def run_shape(length, steps, letter='G'):
    """Letter-shaped generation"""
    try:
        from PIL import Image, ImageDraw, ImageFont
        import numpy as np

        # Create point cloud from letter
        width_pixels = 35
        depth_ratio = 0.15
        fontsize_ratio = 1.2
        fontsize = int(fontsize_ratio * width_pixels)
        depth = int(depth_ratio * width_pixels)

        # Try to find font
        font_paths = [
            "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
            "LiberationSans-Regular.ttf",
        ]
        font = None
        for fp in font_paths:
            if os.path.exists(fp):
                font = ImageFont.truetype(fp, fontsize)
                break

        if font is None:
            # Fallback - generate simple shape
            print(json.dumps({"error": "Font not found for shape generation, using unconditional"}))
            return run_unconditional(length, steps)

        ascent, descent = font.getmetrics()
        text_width = font.getmask(letter).getbbox()[2]
        text_height = font.getmask(letter).getbbox()[3] + descent

        image = Image.new("RGBA", (text_width + 10, text_height + 10), (255, 255, 255))
        draw = ImageDraw.Draw(image)
        draw.text((5, 5), letter, (0, 0, 0), font=font)

        A = np.asarray(image).mean(-1)
        A = A < 100.0
        V = np.ones(list(A.shape) + [depth]) * A[:, :, None]
        X_point_cloud = np.stack(np.nonzero(V), 1)
        X_point_cloud = X_point_cloud + np.random.rand(*X_point_cloud.shape)

        # Limit points
        max_points = 2000
        if X_point_cloud.shape[0] > max_points:
            np.random.shuffle(X_point_cloud)
            X_point_cloud = X_point_cloud[:max_points]

        devnull = open(os.devnull, 'w')
        with redirect_stdout(devnull), redirect_stderr(devnull):
            model = Chroma()
            conditioner = conditioners.ShapeConditioner(
                X_point_cloud,
                model.backbone_network.noise_schedule,
                autoscale_num_residues=length
            )
            proteins = model.sample(
                chain_lengths=[length],
                conditioner=conditioner,
                steps=steps,
                initialize_noise=True
            )
        devnull.close()
        protein = proteins[0] if isinstance(proteins, list) else proteins
        return protein_to_pdb(protein)

    except Exception as e:
        print(json.dumps({"error": f"Shape generation failed: {e}, using unconditional"}))
        return run_unconditional(length, steps)

def run_substructure(pdb_file, selection_string, steps):
    """Motif-based protein design using Chroma's design_selection parameter."""
    devnull = open(os.devnull, 'w')
    with redirect_stdout(devnull), redirect_stderr(devnull):
        model = Chroma()

        # Load protein from PDB file
        protein = Protein(pdb_file)

        if protein.sys.num_chains() == 0:
            raise ValueError("Failed to load protein from PDB - no chains found")

        # Use design method with design_selection
        proteins = model.design(
            protein_init=protein,
            design_selection=selection_string,
            steps=steps
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
            letter = sys.argv[4] if len(sys.argv) > 4 else 'G'
            pdb_content = run_shape(length, steps, letter)
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
