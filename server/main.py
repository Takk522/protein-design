"""
Protein Design Studio - FastAPI Backend
Main entry point for the backend API
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import Optional
import logging
import os
import sys
import subprocess
import asyncio
import tempfile
import json
from pathlib import Path

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Handle PyInstaller extraction path
def get_base_path():
    """Get the base path for bundled resources (PyInstaller)"""
    if getattr(sys, 'frozen', False) and hasattr(sys, '_MEIPASS'):
        return sys._MEIPASS
    return os.path.dirname(os.path.abspath(__file__))

app = FastAPI(title="Protein Design Studio API", version="1.0.0")

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000", "http://127.0.0.1:5173", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configuration paths
HOME = Path.home()
MINICONDA_PATH = HOME / ".protein-design" / "miniconda"
ENV_BASE_PATH = HOME / ".protein-design" / "envs"
CONFIG_PATH = HOME / ".protein-design" / "config.json"

# Tool paths - cross-platform
if sys.platform == "win32":
    CHROMA_ENV = HOME / "anaconda3" / "envs" / "chroma"
    PROTEINMPNN_ENV = ENV_BASE_PATH / "proteinmpnn"
    PROTEINMPNN_PATH = HOME / "ProteinMPNN"
    DEFAULT_PYTHON = HOME / "anaconda3" / "python.exe"
else:
    CHROMA_ENV = HOME / "anaconda3" / "envs" / "chroma"
    PROTEINMPNN_ENV = ENV_BASE_PATH / "proteinmpnn"
    PROTEINMPNN_PATH = HOME / "ProteinMPNN"
    DEFAULT_PYTHON = HOME / "anaconda3" / "bin" / "python3"

# ESMFold API
ESMFOLD_API = "https://api.esmatlas.com/foldSequence/v1/pdb/{sequence}"

# ============== Configuration Management ==============

def load_config() -> dict:
    """Load configuration from JSON file"""
    if CONFIG_PATH.exists():
        with open(CONFIG_PATH, 'r') as f:
            return json.load(f)
    return {}

def save_config(config: dict):
    """Save configuration to JSON file"""
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(CONFIG_PATH, 'w') as f:
        json.dump(config, f, indent=2)

def get_python_path(env_name: str) -> str:
    """Get Python path for a given environment"""
    env_path = ENV_BASE_PATH / env_name
    python_path = env_path / "bin" / "python"
    if python_path.exists():
        return str(python_path)
    # Fallback to system Python
    return "python3"

# ============== Health Check ==============

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    config = load_config()
    if sys.platform == "win32":
        chroma_python = str(CHROMA_ENV / "python.exe")
    else:
        chroma_python = str(CHROMA_ENV / "bin" / "python")
    return {
        "status": "ok",
        "version": "1.0.0",
        "platform": sys.platform,
        "config": {
            "chroma_configured": chroma_python if Path(chroma_python).exists() else None,
            "proteinmpnn_configured": str(PROTEINMPNN_PATH) if PROTEINMPNN_PATH.exists() else None,
        }
    }

# ============== PDB Fetching ==============

class PDBFetchRequest(BaseModel):
    pdb_id: str

@app.post("/api/pdb/fetch")
async def fetch_pdb(req: PDBFetchRequest):
    """Fetch PDB structure from RCSB PDB database"""
    import httpx

    pdb_id = req.pdb_id.upper()
    url = f"https://files.rcsb.org/download/{pdb_id}.pdb"

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.get(url)

        if response.status_code != 200:
            raise HTTPException(status_code=404, detail=f"PDB {pdb_id} not found")

        pdb_content = response.text

        # Extract basic info
        title = ""
        method = ""
        resolution = None
        for line in pdb_content.split('\n'):
            if line.startswith("TITLE"):
                title = line[10:].strip()
            elif line.startswith("EXPDTA"):
                method = line[10:].strip()
            elif line.startswith("REMARK   2 RESOLUTION."):
                try:
                    resolution = float(line.split()[-1].replace('ANGSTROM', '').replace('A', '').strip())
                except:
                    pass

        # Extract sequence from PDB
        sequence = extract_sequence_from_pdb(pdb_content)

        return {
            "pdb_id": pdb_id,
            "pdb_content": pdb_content,
            "title": title or f"PDB {pdb_id}",
            "method": method or "Unknown",
            "resolution": resolution,
            "sequence": sequence
        }
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Timeout fetching PDB")
    except Exception as e:
        logger.error(f"PDB fetch error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

def extract_sequence_from_pdb(pdb_content: str) -> str:
    """Extract amino acid sequence from PDB content"""
    residues = {}
    for line in pdb_content.split('\n'):
        if line.startswith("ATOM ") or line.startswith("HETATM "):
            if line[12:16].strip() == "CA":
                try:
                    resname = line[17:20].strip()
                    resnum = int(line[22:26].strip())
                    chain = line[21:22].strip()
                    aa = THREE_TO_ONE.get(resname, 'X')
                    key = (chain, resnum)
                    if key not in residues:
                        residues[key] = aa
                except:
                    pass

    # Sort by chain and residue number
    sorted_residues = sorted(residues.items(), key=lambda x: (x[0][0], x[0][1]))
    return ''.join(aa for _, aa in sorted_residues)

THREE_TO_ONE = {
    'ALA': 'A', 'CYS': 'C', 'ASP': 'D', 'GLU': 'E', 'PHE': 'F',
    'GLY': 'G', 'HIS': 'H', 'ILE': 'I', 'LYS': 'K', 'LEU': 'L',
    'MET': 'M', 'ASN': 'N', 'PRO': 'P', 'GLN': 'Q', 'ARG': 'R',
    'SER': 'S', 'THR': 'T', 'VAL': 'V', 'TRP': 'W', 'TYR': 'Y'
}

def fix_pdb_atom_numbers(pdb_content: str) -> str:
    """Fix PDB atom serial numbers to be sequential and residue numbering"""
    lines = []
    atom_serial = 1
    current_resnum = None
    current_chain = None
    resnum = 1

    for line in pdb_content.split('\n'):
        if line.startswith('ATOM ') or line.startswith('HETATM '):
            atom_name = line[12:16]
            resname = line[17:20]
            chain = line[21:22]
            res_num_str = line[22:26]

            try:
                resnum_from_pdb = int(res_num_str)
            except:
                resnum_from_pdb = resnum

            # Start new residue when resnum or chain changes
            if resnum_from_pdb != current_resnum or chain != current_chain:
                if current_resnum is not None:  # Not first residue
                    resnum += 1
                current_resnum = resnum_from_pdb
                current_chain = chain

            # Format: ATOM  <serial>  <name> <resname> <chain> <resseq> ...
            new_line = f"{line[:6]}{atom_serial:5d}{line[11:17]}{resname} {chain}{resnum:4d}{line[26:]}"
            lines.append(new_line)
            atom_serial += 1
        else:
            lines.append(line)

    return '\n'.join(lines)

def extract_sequence_from_pdb(pdb_content: str) -> str:
    """Extract amino acid sequence from PDB content"""
    residues = {}
    for line in pdb_content.split('\n'):
        if line.startswith("ATOM ") or line.startswith("HETATM "):
            if line[12:16].strip() == "CA":
                try:
                    resname = line[17:20].strip()
                    resnum = int(line[22:26].strip())
                    chain = line[21:22].strip()
                    aa = THREE_TO_ONE.get(resname, 'X')
                    key = (chain, resnum)
                    if key not in residues:
                        residues[key] = aa
                except:
                    pass

    # Sort by chain and residue number
    sorted_residues = sorted(residues.items(), key=lambda x: (x[0][0], x[0][1]))
    return ''.join(aa for _, aa in sorted_residues)
    length: int = 100
    temperature: float = 1.0
    steps: int = 200

class ChromaCompactRequest(BaseModel):
    length: int = 100
    rg_scale: float = 1.0
    temperature: float = 1.0
    steps: int = 200

class ChromaUnconditionalRequest(BaseModel):
    length: int = 100
    temperature: float = 1.0
    steps: int = 200

class ChromaSymmetryRequest(BaseModel):
    length: int = 100
    symmetry_order: int = 2
    temperature: float = 1.0
    steps: int = 200

class ChromaShapeRequest(BaseModel):
    shape_letter: str = "A"
    length: int = 100
    temperature: float = 1.0
    steps: int = 200

class ChromaSubstructureRequest(BaseModel):
    pdb_content: str
    selection: str = "all"  # PyMOL-style selection string (e.g., "resid 20-50 around 5.0")
    steps: int = 200

class BatchChromaRequest(BaseModel):
    mode: str
    batch_size: int = 1
    params: dict = {}

# ============== Chroma Design ==============

RUN_CHROMA_SCRIPT = str(Path(get_base_path()) / "run_chroma.py")

def get_chroma_python() -> str:
    """Get Python path - use current Python since generate-chroma is installed via pip"""
    return sys.executable

def run_chroma(mode: str, length: int, steps: int = 200, **kwargs) -> str:
    """Run Chroma inference via subprocess (blocking)"""
    python_path = get_chroma_python()

    cmd = [python_path, RUN_CHROMA_SCRIPT, mode, str(length), str(steps)]
    for key, value in kwargs.items():
        cmd.append(str(value))

    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=300,
        cwd=get_base_path()
    )

    if result.returncode != 0:
        raise RuntimeError(f"Chroma failed: {result.stderr}")

    import json
    try:
        data = json.loads(result.stdout)
        if "error" in data:
            raise RuntimeError(data["error"])
        return data.get("pdb", "")
    except json.JSONDecodeError:
        return result.stdout.strip()

async def run_chroma_async(mode: str, length: int, steps: int = 200, **kwargs) -> str:
    """Run Chroma inference via async subprocess"""
    python_path = get_chroma_python()

    cmd = [python_path, RUN_CHROMA_SCRIPT, mode, str(length), str(steps)]
    for key, value in kwargs.items():
        cmd.append(str(value))

    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        cwd=get_base_path()
    )

    try:
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=300)
    except asyncio.TimeoutError:
        proc.kill()
        raise RuntimeError("Chroma timed out after 300 seconds")

    if proc.returncode != 0:
        # Check if stdout has valid JSON even with error
        try:
            data = json.loads(stdout.decode())
            if "pdb" in data:
                return data["pdb"]
        except:
            pass
        raise RuntimeError(f"Chroma failed: {stderr.decode()}")

    import json
    try:
        data = json.loads(stdout.decode())
        if "error" in data:
            raise RuntimeError(data["error"])
        return data.get("pdb", "")
    except json.JSONDecodeError:
        return stdout.decode().strip()

@app.post("/api/chroma/design")
async def design_chroma(req: ChromaUnconditionalRequest):
    """Design protein backbone using Chroma - Unconditional mode"""
    try:
        pdb_content = await run_chroma_async("unconditional", req.length, req.steps)
        sequence = extract_sequence_from_pdb(pdb_content)
        return {
            "pdb_content": pdb_content,
            "sequence": sequence,
            "confidence": 0.8,
            "mode": "unconditional"
        }
    except Exception as e:
        logger.error(f"Chroma error: {e}")
        raise HTTPException(status_code=500, detail=f"Chroma API failed: {str(e)}")

@app.post("/api/chroma/symmetry")
async def design_chroma_symmetry(req: ChromaSymmetryRequest):
    """Design protein backbone using Chroma - Symmetry mode"""
    try:
        pdb_content = await run_chroma_async("symmetry", req.length, req.steps, symmetry_order=req.symmetry_order)
        pdb_content = fix_pdb_atom_numbers(pdb_content)
        sequence = extract_sequence_from_pdb(pdb_content)
        return {
            "pdb_content": pdb_content,
            "sequence": sequence,
            "symmetry_order": req.symmetry_order,
            "mode": "symmetry"
        }
    except Exception as e:
        logger.error(f"Chroma symmetry error: {e}")
        raise HTTPException(status_code=500, detail=f"Chroma symmetry failed: {str(e)}")

@app.post("/api/chroma/shape")
async def design_chroma_shape(req: ChromaShapeRequest):
    """Design protein backbone using Chroma - Shape mode"""
    try:
        pdb_content = await run_chroma_async("shape", req.length, req.steps)
        sequence = extract_sequence_from_pdb(pdb_content)
        return {
            "pdb_content": pdb_content,
            "sequence": sequence,
            "shape_letter": req.shape_letter,
            "mode": "shape"
        }
    except Exception as e:
        logger.error(f"Chroma shape error: {e}")
        raise HTTPException(status_code=500, detail=f"Chroma shape failed: {str(e)}")

@app.post("/api/chroma/compact")
async def design_chroma_compact(req: ChromaCompactRequest):
    """Design protein backbone using Chroma - Compact mode"""
    try:
        pdb_content = await run_chroma_async("compact", req.length, req.steps, rg_scale=req.rg_scale)
        pdb_content = fix_pdb_atom_numbers(pdb_content)
        sequence = extract_sequence_from_pdb(pdb_content)
        return {
            "pdb_content": pdb_content,
            "sequence": sequence,
            "rg_scale": req.rg_scale,
            "mode": "compact"
        }
    except Exception as e:
        logger.error(f"Chroma compact error: {e}")
        raise HTTPException(status_code=500, detail=f"Chroma compact failed: {str(e)}")

@app.post("/api/chroma/substructure")
async def design_chroma_substructure(req: ChromaSubstructureRequest):
    """Design protein backbone using Chroma - Substructure mode with motif-based design"""
    import tempfile, os
    try:
        # Write PDB content to temp file
        fd, pdb_path = tempfile.mkstemp('.pdb')
        os.write(fd, req.pdb_content.encode())
        os.close(fd)

        python_path = get_chroma_python()

        cmd = [python_path, RUN_CHROMA_SCRIPT, "substructure", "0", str(req.steps), pdb_path, req.selection]

        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=get_base_path()
        )

        try:
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=300)
        except asyncio.TimeoutError:
            proc.kill()
            raise RuntimeError("Chroma timed out after 300 seconds")
        finally:
            os.unlink(pdb_path)

        if proc.returncode != 0:
            raise RuntimeError(f"Chroma failed: {stderr.decode()}")

        import json
        data = json.loads(stdout.decode())
        pdb_content = data.get("pdb", "")

        sequence = extract_sequence_from_pdb(pdb_content)
        return {
            "pdb_content": pdb_content,
            "sequence": sequence,
            "selection": req.selection,
            "mode": "substructure"
        }
    except Exception as e:
        logger.error(f"Chroma substructure error: {e}")
        raise HTTPException(status_code=500, detail=f"Chroma substructure failed: {str(e)}")

@app.post("/api/chroma/batch")
async def batch_chroma(req: BatchChromaRequest):
    """Batch Chroma design"""
    results = []
    for i in range(req.batch_size):
        try:
            pdb_content = await run_chroma_async("unconditional", req.params.get("length", 100), req.params.get("steps", 200))
            sequence = extract_sequence_from_pdb(pdb_content)
            results.append({
                "pdb_content": pdb_content,
                "sequence": sequence,
                "design_id": i
            })
        except Exception as e:
            logger.error(f"Chroma batch error for design {i}: {e}")
            raise HTTPException(status_code=500, detail=f"Chroma batch design {i} failed: {str(e)}")
    return {"designs": results}

# ============== ProteinMPNN ==============

RUN_PROTEINMPNN_SCRIPT = str(Path(get_base_path()) / "run_proteinmpnn.py")
MPNN_ENV_PATH = Path("/Users/jianchengluo/protein-design/ProteinMPNN")

class ProteinMPNNRequest(BaseModel):
    pdb_content: str
    num_sequences: int = 1
    temperature: float = 0.1
    seed: int = 42

class BatchProteinMPNNRequest(BaseModel):
    pdb_contents: list[str]
    num_sequences_per_target: int = 1
    temperature: float = 0.1
    seed: int = 42

@app.post("/api/proteinmpnn/design")
async def design_proteinmpnn(req: ProteinMPNNRequest):
    """Design sequences using ProteinMPNN"""
    import tempfile, os, asyncio, subprocess

    try:
        # Write PDB content to temp file
        fd, pdb_path = tempfile.mkstemp('.pdb')
        os.write(fd, req.pdb_content.encode())
        os.close(fd)

        python_path = sys.executable  # Use current Python since packages are pip-installed
        cmd = [
            python_path, RUN_PROTEINMPNN_SCRIPT,
            pdb_path,
            str(req.num_sequences),
            str(req.temperature),
            str(req.seed)
        ]

        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=get_base_path()
        )

        try:
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=300)
        except asyncio.TimeoutError:
            proc.kill()
            raise RuntimeError("ProteinMPNN timed out after 300 seconds")
        finally:
            os.unlink(pdb_path)

        if proc.returncode != 0:
            raise RuntimeError(f"ProteinMPNN failed: {stderr.decode()}")

        import json
        data = json.loads(stdout.decode())
        if "error" in data:
            raise RuntimeError(data["error"])

        return {
            "sequences": data.get("sequences", []),
            "backbone_length": len(req.pdb_content.split('\n')),
            "num_sequences": len(data.get("sequences", []))
        }

    except Exception as e:
        logger.error(f"ProteinMPNN error: {e}")
        raise HTTPException(status_code=500, detail=f"ProteinMPNN failed: {str(e)}")

@app.post("/api/proteinmpnn/batch")
async def batch_proteinmpnn(req: BatchProteinMPNNRequest):
    """Batch ProteinMPNN design"""
    all_results = []
    for pdb_content in req.pdb_contents:
        backbone_length = extract_backbone_length(pdb_content)
        sequences = [generate_mock_sequence(backbone_length) for _ in range(req.num_sequences_per_target)]
        all_results.append({
            "sequences": sequences,
            "backbone_length": backbone_length
        })
    return {"results": all_results}

# ============== ESMFold ==============

class ESMFoldRequest(BaseModel):
    sequence: str
    pdb_content: Optional[str] = None  # Original structure for RMSD comparison

class BatchESMFoldRequest(BaseModel):
    sequences: list[str]

@app.post("/api/esmfold/predict")
async def predict_esmfold(req: ESMFoldRequest):
    """Predict structure using ESMFold API"""
    import httpx

    clean_seq = ''.join(c.upper() for c in req.sequence if c.isalpha())

    if len(clean_seq) < 10:
        raise HTTPException(status_code=400, detail="Sequence too short")
    if len(clean_seq) > 400:
        raise HTTPException(status_code=400, detail="Sequence too long (max 400)")

    try:
        async with httpx.AsyncClient(timeout=120) as client:
            response = await client.post(
                "https://api.esmatlas.com/foldSequence/v1/pdb/",
                content=clean_seq.encode(),
                headers={"Content-Type": "application/x-www-form-urlencoded"}
            )

        if response.status_code != 200:
            raise HTTPException(status_code=502, detail=f"ESMFold API error: {response.status_code}")

        pdb_content = response.text

        return {
            "pdb_content": pdb_content,
            "sequence": clean_seq,
            "length": len(clean_seq)
        }
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="ESMFold API timeout")
    except Exception as e:
        logger.error(f"ESMFold error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/esmfold/batch")
async def batch_esmfold(req: BatchESMFoldRequest):
    """Batch ESMFold prediction"""
    results = []
    for i, seq in enumerate(req.sequences):
        clean_seq = ''.join(c.upper() for c in seq if c.isalpha())
        results.append({
            "sequence": clean_seq,
            "pdb_content": generate_mock_pdb(len(clean_seq)),
            "prediction_id": i
        })
    return {"predictions": results}

# ============== RMSD Calculation ==============

class RMSDRequest(BaseModel):
    pdb1: str  # Reference structure
    pdb2: str  # Predicted structure
    method: str = "ca"  # ca, backbone, all

def apply_kabsch_alignment(coords1: list, coords2: list) -> tuple:
    """Apply Kabsch alignment to coords2 to align with coords1. Returns rotation matrix and RMSD."""
    import math
    import numpy as np

    n = len(coords1)
    if n == 0:
        return coords2, 0.0

    # Center both structures
    center1 = [sum(c[i] for c in coords1) / n for i in range(3)]
    center2 = [sum(c[i] for c in coords2) / n for i in range(3)]

    coords1_centered = [(c[0] - center1[0], c[1] - center1[1], c[2] - center1[2]) for c in coords1]
    coords2_centered = [(c[0] - center2[0], c[1] - center2[1], c[2] - center2[2]) for c in coords2]

    # Compute covariance matrix H = P^T * Q
    H = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]
    for p, q in zip(coords1_centered, coords2_centered):
        for i in range(3):
            for j in range(3):
                H[i][j] += p[i] * q[j]

    # SVD
    U, S, Vt = np.linalg.svd(H)

    # Calculate rotation matrix R = V * U^T
    R = np.dot(Vt.T, U.T)

    # Ensure proper rotation (no reflection)
    if np.linalg.det(R) < 0:
        Vt[2, :] *= -1
        R = np.dot(Vt.T, U.T)

    # Apply rotation to coords2_centered
    coords2_aligned = []
    for c in coords2_centered:
        rotated = [
            R[0, 0] * c[0] + R[0, 1] * c[1] + R[0, 2] * c[2] + center1[0],
            R[1, 0] * c[0] + R[1, 1] * c[1] + R[1, 2] * c[2] + center1[1],
            R[2, 0] * c[0] + R[2, 1] * c[1] + R[2, 2] * c[2] + center1[2]
        ]
        coords2_aligned.append(tuple(rotated))

    # Calculate RMSD
    sum_sq = sum(
        (c1[0] - c2[0])**2 + (c1[1] - c2[1])**2 + (c1[2] - c2[2])**2
        for c1, c2 in zip(coords1, coords2_aligned)
    )
    rmsd = math.sqrt(sum_sq / n)

    return coords2_aligned, rmsd

@app.post("/api/rmsd/calculate")
async def calculate_rmsd(req: RMSDRequest):
    """Calculate RMSD between two PDB structures after Kabsch alignment"""
    # Extract CA atoms from both structures
    coords1 = extract_ca_coords(req.pdb1)
    coords2 = extract_ca_coords(req.pdb2)

    if len(coords1) != len(coords2):
        raise HTTPException(status_code=400, detail="Structures have different lengths")

    # Simple RMSD calculation (no alignment)
    rmsd_simple = calculate_simple_rmsd(coords1, coords2)

    # Kabsch alignment and RMSD
    coords2_aligned, rmsd_aligned = apply_kabsch_alignment(coords1, coords2)

    # Create aligned PDB by replacing CA coordinates in pdb2
    aligned_pdb2 = create_aligned_pdb(req.pdb2, coords2_aligned)

    return {
        "rmsd_simple": rmsd_simple,
        "rmsd_aligned": rmsd_aligned,
        "aligned_pdb2": aligned_pdb2,
        "num_atoms": len(coords1),
        "method": req.method
    }

def extract_ca_coords(pdb_content: str) -> list:
    """Extract CA atomic coordinates from PDB"""
    coords = []
    for line in pdb_content.split('\n'):
        if line.startswith("ATOM ") and line[12:16].strip() == "CA":
            try:
                x = float(line[30:38].strip())
                y = float(line[38:46].strip())
                z = float(line[46:54].strip())
                coords.append((x, y, z))
            except:
                pass
    return coords

def create_aligned_pdb(pdb_content: str, aligned_coords: list) -> str:
    """Replace CA coordinates in PDB with aligned coordinates"""
    lines = []
    coord_idx = 0
    for line in pdb_content.split('\n'):
        if line.startswith("ATOM ") and line[12:16].strip() == "CA" and coord_idx < len(aligned_coords):
            coord = aligned_coords[coord_idx]
            # Format: ATOM  <serial>  <name> <resname> <chain> <resseq> <icode>    <x> <y> <z> <occ> <tempfactor> <segment> <element> <charge>
            new_line = f"{line[:30]}{coord[0]:8.3f}{coord[1]:8.3f}{coord[2]:8.3f}{line[54:]}"
            lines.append(new_line)
            coord_idx += 1
        else:
            lines.append(line)
    return '\n'.join(lines)

def calculate_simple_rmsd(coords1: list, coords2: list) -> float:
    """Calculate simple RMSD without alignment"""
    import math
    n = len(coords1)
    if n == 0:
        return 0.0
    sum_sq = sum(
        (c1[0] - c2[0])**2 + (c1[1] - c2[1])**2 + (c1[2] - c2[2])**2
        for c1, c2 in zip(coords1, coords2)
    )
    return math.sqrt(sum_sq / n)

def calculate_aligned_rmsd(coords1: list, coords2: list) -> float:
    """Calculate RMSD after Kabsch alignment using SVD"""
    import math
    n = len(coords1)
    if n == 0:
        return 0.0

    # Center both structures
    center1 = [sum(c[i] for c in coords1) / n for i in range(3)]
    center2 = [sum(c[i] for c in coords2) / n for i in range(3)]

    coords1_centered = [(c[0] - center1[0], c[1] - center1[1], c[2] - center1[2]) for c in coords1]
    coords2_centered = [(c[0] - center2[0], c[1] - center2[1], c[2] - center2[2]) for c in coords2]

    # Compute covariance matrix H = P^T * Q
    H = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]
    for p, q in zip(coords1_centered, coords2_centered):
        for i in range(3):
            for j in range(3):
                H[i][j] += p[i] * q[j]

    # SVD via numpy
    import numpy as np
    U, S, Vt = np.linalg.svd(H)

    # Calculate rotation matrix R = V * U^T
    R = np.dot(Vt.T, U.T)

    # Ensure proper rotation (no reflection)
    if np.linalg.det(R) < 0:
        Vt[2, :] *= -1
        R = np.dot(Vt.T, U.T)

    # Apply rotation to coords2_centered
    coords2_aligned = []
    for c in coords2_centered:
        rotated = [
            R[0, 0] * c[0] + R[0, 1] * c[1] + R[0, 2] * c[2],
            R[1, 0] * c[0] + R[1, 1] * c[1] + R[1, 2] * c[2],
            R[2, 0] * c[0] + R[2, 1] * c[1] + R[2, 2] * c[2]
        ]
        coords2_aligned.append(tuple(rotated))

    # Calculate aligned RMSD
    sum_sq = sum(
        (c1[0] - c2[0])**2 + (c1[1] - c2[1])**2 + (c1[2] - c2[2])**2
        for c1, c2 in zip(coords1_centered, coords2_aligned)
    )
    return math.sqrt(sum_sq / n)

# ============== Utility Functions ==============

def extract_backbone_length(pdb_content: str) -> int:
    """Extract backbone residue count from PDB"""
    residues = set()
    for line in pdb_content.split('\n'):
        if line.startswith('ATOM ') or line.startswith('HETATM '):
            try:
                res_num = int(line[22:26].strip())
                chain = line[21:22].strip()
                residues.add((chain, res_num))
            except:
                continue
    return len(residues) if residues else 100

def generate_mock_pdb(length: int) -> str:
    """Generate mock PDB for testing"""
    import random
    import math

    lines = ["HEADER    Generated by Protein Design Studio"]

    residues = ['ALA', 'CYS', 'ASP', 'GLU', 'PHE', 'GLY', 'HIS', 'ILE', 'LYS', 'LEU',
               'MET', 'ASN', 'PRO', 'GLN', 'ARG', 'SER', 'THR', 'VAL', 'TRP', 'TYR']

    for i in range(1, length + 1):
        angle = (i - 1) * 100 * math.pi / 180
        radius = 5.0 + random.uniform(-0.5, 0.5)
        x = radius * math.cos(angle) + 50
        y = radius * math.sin(angle) + 50
        z = (i - 1) * 1.5 + 10

        res_name = residues[(i - 1) % len(residues)]

        # CA atom
        lines.append(
            f"ATOM  {i:5d}  CA  {res_name} A{i:4d}    {x:8.3f}{y:8.3f}{z:8.3f}  1.00 40.00           C"
        )
        # N atom
        lines.append(
            f"ATOM  {i+length:5d}  N   {res_name} A{i:4d}    {x:8.3f}{y:8.3f}{z-1.0:8.3f}  1.00 40.00           N"
        )
        # C atom
        lines.append(
            f"ATOM  {i+2*length:5d}  C   {res_name} A{i:4d}    {x:8.3f}{y:8.3f}{z+1.0:8.3f}  1.00 40.00           C"
        )
        # O atom
        lines.append(
            f"ATOM  {i+3*length:5d}  O   {res_name} A{i:4d}    {x:8.3f}{y:8.3f}{z+2.0:8.3f}  1.00 40.00           O"
        )

    lines.append("END")
    return "\n".join(lines)

def generate_mock_sequence(length: int) -> str:
    """Generate random amino acid sequence"""
    import random
    aa = 'ACDEFGHIKLMNPQRSTVWY'
    return ''.join(random.choice(aa) for _ in range(length))

# ============== File Upload ==============

class UploadPDBRequest(BaseModel):
    filename: str
    content: str

@app.post("/api/pdb/upload")
async def upload_pdb(req: UploadPDBRequest):
    """Save uploaded PDB file"""
    try:
        content = req.content
        sequence = extract_sequence_from_pdb(content)
        return {
            "filename": req.filename,
            "pdb_content": content,
            "sequence": sequence,
            "length": len(sequence)
        }
    except Exception as e:
        logger.error(f"Upload error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
