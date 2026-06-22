#!/usr/bin/env python3
"""
Chroma inference runner script
Usage: python3 run_chroma.py [mode] [length] [steps] [extra_params...]
"""

import sys
import json
import traceback
import tempfile
import os

# Write logs to temp file for debugging - use fixed path in same dir as script
LOG_DIR = os.path.dirname(os.path.abspath(__file__))
LOG_FILE = os.path.join(LOG_DIR, "chroma_debug.log")

def log(msg):
    timestamp = __import__('datetime').datetime.now().isoformat()
    line = f"[{timestamp}] {msg}\n"
    with open(LOG_FILE, 'a') as f:
        f.write(line)
    print(line, end='', flush=True)

log(f"=== run_chroma.py STARTED ===")
log(f"sys.executable: {sys.executable}")
log(f"sys.version: {sys.version}")
log(f"sys.argv: {sys.argv}")
log(f"CWD: {os.getcwd()}")

try:
    from chroma import api
    from chroma import Chroma, Protein
    from chroma import conditioners
    from chroma.layers.structure.conditioners import (
        SymmetryConditioner, ShapeConditioner, RgConditioner, SubstructureConditioner
    )
    from chroma.layers.structure.symmetry import get_point_group
    log("Chroma imports successful")
except ImportError as e:
    log(f"Import error: {e}")
    import traceback
    log(f"Traceback: {traceback.format_exc()}")
    print(json.dumps({"error": f"Failed to import chroma: {e}. Install with: pip install generate-chroma"}))
    sys.exit(1)
except Exception as e:
    log(f"Unexpected import error: {e}")
    import traceback
    log(f"Traceback: {traceback.format_exc()}")
    print(json.dumps({"error": str(e), "traceback": traceback.format_exc()}))
    sys.exit(1)

# Register API key
API_KEY = os.environ.get('CHROMA_API_KEY', '8a633008828649bda2b1431721abdb3f')
log(f"Registering API key: {API_KEY[:10]}...")
try:
    api.register_key(API_KEY)
    log("API key registered")
except Exception as e:
    log(f"API key registration error: {e}")

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
    log(f"Starting unconditional generation: length={length}, steps={steps}")
    model = Chroma()
    log("Chroma model created")
    proteins = model.sample(
        chain_lengths=[length],
        steps=steps,
        initialize_noise=True
    )
    log("Sampling complete")
    protein = proteins[0] if isinstance(proteins, list) else proteins
    return protein_to_pdb(protein)

def run_symmetry(length, symmetry_order, steps):
    """Symmetric generation"""
    log(f"Starting symmetry generation: length={length}, order={symmetry_order}, steps={steps}")
    pg_map = {2: 'C_2', 3: 'C_3', 4: 'C_4'}
    pg_name = pg_map.get(symmetry_order, 'C_2')
    G = get_point_group(pg_name)
    model = Chroma()
    conditioner = conditioners.SymmetryConditioner(G=G, num_chain_neighbors=symmetry_order)
    proteins = model.sample(
        chain_lengths=[length],
        conditioner=conditioner,
        steps=steps,
        initialize_noise=True
    )
    protein = proteins[0] if isinstance(proteins, list) else proteins
    return protein_to_pdb(protein)

def run_compact(length, rg_scale, steps):
    """Compact/Rg-conditioned generation"""
    log(f"Starting compact generation: length={length}, rg_scale={rg_scale}, steps={steps}")
    try:
        model = Chroma()
        conditioner = conditioners.RgConditioner(scale=rg_scale)
        proteins = model.sample(
            chain_lengths=[length],
            conditioner=conditioner,
            steps=steps,
            initialize_noise=True
        )
        protein = proteins[0] if isinstance(proteins, list) else proteins
        return protein_to_pdb(protein)
    except Exception as e:
        log(f"Compact failed, trying unconditional: {e}")
        return run_unconditional(length, steps)

def run_shape(length, steps, letter='G'):
    """Letter-shaped generation"""
    log(f"Starting shape generation: length={length}, letter={letter}, steps={steps}")
    try:
        from PIL import Image, ImageDraw, ImageFont
        import numpy as np

        width_pixels = 35
        depth_ratio = 0.15
        fontsize_ratio = 1.2
        fontsize = int(fontsize_ratio * width_pixels)
        depth = int(depth_ratio * width_pixels)

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
            log("Font not found, using unconditional")
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

        max_points = 2000
        if X_point_cloud.shape[0] > max_points:
            np.random.shuffle(X_point_cloud)
            X_point_cloud = X_point_cloud[:max_points]

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
        protein = proteins[0] if isinstance(proteins, list) else proteins
        return protein_to_pdb(protein)

    except Exception as e:
        log(f"Shape failed: {e}")
        return run_unconditional(length, steps)

def run_substructure(pdb_file, selection_string, steps):
    """Motif-based protein design"""
    log(f"Starting substructure: file={pdb_file}, selection={selection_string}, steps={steps}")
    model = Chroma()
    protein = Protein(pdb_file)
    if protein.sys.num_chains() == 0:
        raise ValueError("Failed to load protein from PDB")
    proteins = model.design(
        protein_init=protein,
        design_selection=selection_string,
        steps=steps
    )
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
        log(f"Mode: {mode}, Length: {length}, Steps: {steps}")
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

        log("Success!")
        print(json.dumps({"pdb": pdb_content, "success": True}))

    except Exception as e:
        tb = traceback.format_exc()
        log(f"Error: {e}")
        log(f"Traceback: {tb}")
        print(json.dumps({"error": str(e), "traceback": tb}))
        sys.exit(1)

if __name__ == "__main__":
    main()
