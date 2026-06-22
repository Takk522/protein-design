#!/usr/bin/env python3
"""
ProteinMPNN inference runner script
Usage: python3 run_proteinmpnn.py [pdb_content] [num_sequences] [temperature] [seed]

This script:
1. Saves PDB content to a temp file
2. Parses PDB to JSONL using parse_multiple_chains.py
3. Runs ProteinMPNN to generate sequences
4. Returns sequences from output FASTA
"""

import sys
import json
import traceback
import tempfile
import os
import subprocess
from pathlib import Path

# Get the directory where this script is located
SCRIPT_DIR = Path(__file__).parent.resolve()
# ProteinMPNN is in the same repo, sibling to server directory
# Navigate from server/ to repo root and then to ProteinMPNN
REPO_ROOT = SCRIPT_DIR.parent
PROTEINMPNN_PATH = REPO_ROOT / "ProteinMPNN"

# Paths for ProteinMPNN scripts
PARSE_SCRIPT = PROTEINMPNN_PATH / "helper_scripts" / "parse_multiple_chains.py"
MPNN_SCRIPT = PROTEINMPNN_PATH / "protein_mpnn_run.py"

def get_python_path():
    """Get Python executable - use current Python"""
    return sys.executable

def run_proteinmpnn(pdb_content: str, num_sequences: int = 1, temperature: float = 0.1, seed: int = 42) -> list:
    """Run ProteinMPNN on PDB content and return list of sequences"""

    python_path = get_python_path()

    # Create temp directory
    temp_dir = tempfile.mkdtemp()
    pdb_path = os.path.join(temp_dir, "input.pdb")
    parsed_path = os.path.join(temp_dir, "parsed_pdbs.jsonl")
    output_dir = os.path.join(temp_dir, "outputs")

    try:
        # Write PDB content to temp file
        with open(pdb_path, 'w') as f:
            f.write(pdb_content)

        os.makedirs(output_dir, exist_ok=True)

        # Step 1: Parse PDB to JSONL
        parse_cmd = [
            python_path, str(PARSE_SCRIPT),
            "--input_path", temp_dir + "/",
            "--output_path", parsed_path
        ]
        parse_result = subprocess.run(parse_cmd, capture_output=True, text=True)

        if parse_result.returncode != 0:
            raise RuntimeError(f"Parse failed: {parse_result.stderr}")

        # Check if parsed file exists
        if not os.path.exists(parsed_path):
            raise RuntimeError(f"Parsed PDB file not created at {parsed_path}")

        # Step 2: Run ProteinMPNN
        mpnn_cmd = [
            python_path, str(MPNN_SCRIPT),
            "--jsonl_path", parsed_path,
            "--out_folder", output_dir,
            "--num_seq_per_target", str(num_sequences),
            "--sampling_temp", str(temperature),
            "--seed", str(seed),
            "--batch_size", "1"
        ]

        result = subprocess.run(mpnn_cmd, capture_output=True, text=True, timeout=300)

        if result.returncode != 0:
            raise RuntimeError(f"ProteinMPNN failed: {result.stderr}")

        # Step 3: Read output sequences from FASTA
        seqs = []

        # FASTA files are in output_dir/seqs/ subdirectory
        seqs_dir = os.path.join(output_dir, 'seqs')
        if not os.path.exists(seqs_dir):
            raise RuntimeError(f"No seqs directory found at {seqs_dir}")

        fasta_files = [f for f in os.listdir(seqs_dir) if f.endswith('.fa')]

        if not fasta_files:
            raise RuntimeError("No FASTA output file generated")

        fasta_path = os.path.join(seqs_dir, fasta_files[0])
        with open(fasta_path, 'r') as f:
            content = f.read()
            # Parse FASTA format
            current_seq = ""
            for line in content.split('\n'):
                if line.startswith('>'):
                    if current_seq:
                        seqs.append(current_seq)
                    current_seq = ""
                else:
                    current_seq += line.strip()
            if current_seq:
                seqs.append(current_seq)

        return seqs

    finally:
        # Cleanup temp directory
        import shutil
        shutil.rmtree(temp_dir, ignore_errors=True)

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: run_proteinmpnn.py [pdb_content_file] [num_sequences] [temperature] [seed]"}))
        sys.exit(1)

    pdb_file = sys.argv[1]
    num_sequences = int(sys.argv[2]) if len(sys.argv) > 2 else 1
    temperature = float(sys.argv[3]) if len(sys.argv) > 3 else 0.1
    seed = int(sys.argv[4]) if len(sys.argv) > 4 else 42

    try:
        # Read PDB content from file
        with open(pdb_file, 'r') as f:
            pdb_content = f.read()

        sequences = run_proteinmpnn(pdb_content, num_sequences, temperature, seed)

        print(json.dumps({"sequences": sequences, "success": True}))

    except Exception as e:
        print(json.dumps({"error": str(e), "traceback": traceback.format_exc()}))
        sys.exit(1)

if __name__ == "__main__":
    main()
