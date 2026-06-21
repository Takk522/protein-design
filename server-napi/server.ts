/**
 * Protein Design Studio - Node.js Backend
 * Cross-platform backend server that doesn't require Python
 */

import express, { Request, Response } from 'express';
import cors from 'cors';
import axios from 'axios';

const app = express();
const PORT = 8000;

app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:3000', 'http://127.0.0.1:5173'],
  credentials: true
}));
app.use(express.json({ limit: '50mb' }));

// Logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Health check
app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    version: '1.0.0',
    platform: process.platform,
    backend: 'nodejs'
  });
});

// PDB Fetch - fetch from RCSB PDB
app.post('/api/pdb/fetch', async (req: Request, res: Response) => {
  try {
    const { pdb_id } = req.body;
    if (!pdb_id) {
      res.status(400).json({ error: 'PDB ID is required' });
      return;
    }

    const response = await axios.get(
      `https://files.rcsb.org/download/${pdb_id.toUpperCase()}.pdb`,
      { timeout: 30000 }
    );

    const pdbContent = response.data as string;
    const sequence = extractSequenceFromPdb(pdbContent);

    res.json({
      pdb_id: pdb_id.toUpperCase(),
      pdb_content: pdbContent,
      title: extractTitle(pdbContent) || `PDB ${pdb_id}`,
      method: extractMethod(pdbContent) || 'Unknown',
      resolution: extractResolution(pdbContent),
      sequence
    });
  } catch (error: any) {
    console.error('PDB fetch error:', error.message);
    if (error.response?.status === 404) {
      res.status(404).json({ error: `PDB ${req.body.pdb_id} not found` });
    } else {
      res.status(500).json({ error: error.message });
    }
  }
});

// ESMFold prediction via API
app.post('/api/esmfold/predict', async (req: Request, res: Response) => {
  try {
    const { sequence } = req.body;
    if (!sequence) {
      res.status(400).json({ error: 'Sequence is required' });
      return;
    }

    const cleanSeq = sequence.replace(/[^A-Za-z]/g, '').toUpperCase();

    if (cleanSeq.length < 10) {
      res.status(400).json({ error: 'Sequence too short (min 10 residues)' });
      return;
    }
    if (cleanSeq.length > 400) {
      res.status(400).json({ error: 'Sequence too long (max 400 residues)' });
      return;
    }

    const response = await axios.post(
      'https://api.esmatlas.com/foldSequence/v1/pdb/',
      cleanSeq,
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 120000
      }
    );

    res.json({
      pdb_content: response.data,
      sequence: cleanSeq,
      length: cleanSeq.length
    });
  } catch (error: any) {
    console.error('ESMFold error:', error.message);
    if (error.code === 'ECONNABORTED') {
      res.status(504).json({ error: 'ESMFold API timeout' });
    } else {
      res.status(500).json({ error: error.message });
    }
  }
});

// Chroma design (mock implementation for now)
app.post('/api/chroma/design', async (req: Request, res: Response) => {
  try {
    const { length = 100, steps = 200 } = req.body;
    // Return mock PDB - real implementation would call Chroma
    res.json({
      pdb_content: generateMockPdb(length),
      sequence: generateMockSequence(length),
      confidence: 0.8,
      mode: 'unconditional',
      note: 'This is a mock response. Chroma integration requires additional setup.'
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Chroma symmetry (mock)
app.post('/api/chroma/symmetry', async (req: Request, res: Response) => {
  try {
    const { length = 100, symmetry_order = 2 } = req.body;
    res.json({
      pdb_content: generateMockPdb(length * symmetry_order),
      sequence: generateMockSequence(length * symmetry_order),
      symmetry_order,
      mode: 'symmetry',
      note: 'This is a mock response.'
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Chroma shape (mock)
app.post('/api/chroma/shape', async (req: Request, res: Response) => {
  try {
    const { length = 100, shape_letter = 'A' } = req.body;
    res.json({
      pdb_content: generateMockPdb(length),
      sequence: generateMockSequence(length),
      shape_letter,
      mode: 'shape',
      note: 'This is a mock response.'
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Chroma compact (mock)
app.post('/api/chroma/compact', async (req: Request, res: Response) => {
  try {
    const { length = 100, rg_scale = 1.0 } = req.body;
    res.json({
      pdb_content: generateMockPdb(length),
      sequence: generateMockSequence(length),
      rg_scale,
      mode: 'compact',
      note: 'This is a mock response.'
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ProteinMPNN design (mock)
app.post('/api/proteinmpnn/design', async (req: Request, res: Response) => {
  try {
    const { pdb_content, num_sequences = 1 } = req.body;
    const backboneLength = extractBackboneLength(pdb_content || '');
    const sequences = Array(num_sequences).fill(null).map(() => generateMockSequence(backboneLength || 100));

    res.json({
      sequences,
      backbone_length: backboneLength || 100,
      num_sequences: num_sequences,
      note: 'This is a mock response. ProteinMPNN integration requires additional setup.'
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// RMSD calculation (simplified)
app.post('/api/rmsd/calculate', async (req: Request, res: Response) => {
  try {
    const { pdb1, pdb2 } = req.body;
    const coords1 = extractCaCoords(pdb1);
    const coords2 = extractCaCoords(pdb2);

    if (coords1.length !== coords2.length) {
      res.status(400).json({ error: 'Structures have different lengths' });
      return;
    }

    const rmsd = calculateRmsd(coords1, coords2);

    res.json({
      rmsd_simple: rmsd,
      rmsd_aligned: rmsd,
      aligned_pdb2: pdb2,
      num_atoms: coords1.length,
      method: 'ca'
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Helper functions
const THREE_TO_ONE: Record<string, string> = {
  ALA: 'A', CYS: 'C', ASP: 'D', GLU: 'E', PHE: 'F',
  GLY: 'G', HIS: 'H', ILE: 'I', LYS: 'K', LEU: 'L',
  MET: 'M', ASN: 'N', PRO: 'P', GLN: 'Q', ARG: 'R',
  SER: 'S', THR: 'T', VAL: 'V', TRP: 'W', TYR: 'Y'
};

function extractSequenceFromPdb(pdbContent: string): string {
  const residues: Map<string, string> = new Map();
  const lines = pdbContent.split('\n');

  for (const line of lines) {
    if ((line.startsWith('ATOM ') || line.startsWith('HETATM ')) && line.substring(12, 16).trim() === 'CA') {
      try {
        const resname = line.substring(17, 20).trim();
        const resnum = parseInt(line.substring(22, 26).trim());
        const chain = line.substring(21, 22).trim();
        const aa = THREE_TO_ONE[resname] || 'X';
        residues.set(`${chain}${resnum}`, aa);
      } catch {}
    }
  }

  return Array.from(residues.values()).join('');
}

function extractTitle(pdbContent: string): string {
  for (const line of pdbContent.split('\n')) {
    if (line.startsWith('TITLE')) {
      return line.substring(10).trim();
    }
  }
  return '';
}

function extractMethod(pdbContent: string): string {
  for (const line of pdbContent.split('\n')) {
    if (line.startsWith('EXPDTA')) {
      return line.substring(10).trim();
    }
  }
  return '';
}

function extractResolution(pdbContent: string): number | null {
  for (const line of pdbContent.split('\n')) {
    if (line.startsWith('REMARK   2 RESOLUTION.')) {
      const match = line.match(/RESOLUTION\.\s*([\d\.]+)/);
      if (match) return parseFloat(match[1]);
    }
  }
  return null;
}

function extractCaCoords(pdb: string): [number, number, number][] {
  const coords: [number, number, number][] = [];
  for (const line of pdb.split('\n')) {
    if (line.startsWith('ATOM ') && line.substring(12, 16).trim() === 'CA') {
      try {
        const x = parseFloat(line.substring(30, 38).trim());
        const y = parseFloat(line.substring(38, 46).trim());
        const z = parseFloat(line.substring(46, 54).trim());
        coords.push([x, y, z]);
      } catch {}
    }
  }
  return coords;
}

function calculateRmsd(coords1: [number, number, number][], coords2: [number, number, number][]): number {
  if (coords1.length === 0) return 0;
  let sumSq = 0;
  for (let i = 0; i < coords1.length; i++) {
    const dx = coords1[i][0] - coords2[i][0];
    const dy = coords1[i][1] - coords2[i][1];
    const dz = coords1[i][2] - coords2[i][2];
    sumSq += dx * dx + dy * dy + dz * dz;
  }
  return Math.sqrt(sumSq / coords1.length);
}

function extractBackboneLength(pdbContent: string): number {
  const residues = new Set<string>();
  for (const line of pdbContent.split('\n')) {
    if (line.startsWith('ATOM ') || line.startsWith('HETATM ')) {
      try {
        const resnum = line.substring(22, 26).trim();
        const chain = line.substring(21, 22).trim();
        residues.add(`${chain}${resnum}`);
      } catch {}
    }
  }
  return residues.size || 100;
}

function generateMockPdb(length: number): string {
  const residues = ['ALA', 'CYS', 'ASP', 'GLU', 'PHE', 'GLY', 'HIS', 'ILE', 'LYS', 'LEU',
    'MET', 'ASN', 'PRO', 'GLN', 'ARG', 'SER', 'THR', 'VAL', 'TRP', 'TYR'];

  const lines = ['HEADER    Generated by Protein Design Studio'];

  for (let i = 1; i <= length; i++) {
    const angle = (i - 1) * 100 * Math.PI / 180;
    const radius = 5.0 + (Math.random() - 0.5);
    const x = radius * Math.cos(angle) + 50;
    const y = radius * Math.sin(angle) + 50;
    const z = (i - 1) * 1.5 + 10;
    const resName = residues[(i - 1) % residues.length];

    lines.push(`ATOM  ${i.toString().padStart(5)}  CA  ${resName} A${i.toString().padStart(4)}    ${x.toFixed(3).padStart(8)}${y.toFixed(3).padStart(8)}${z.toFixed(3).padStart(8)}  1.00 40.00           C`);
    lines.push(`ATOM  ${(i + length).toString().padStart(5)}  N   ${resName} A${i.toString().padStart(4)}    ${x.toFixed(3).padStart(8)}${y.toFixed(3).padStart(8)}${(z - 1.0).toFixed(3).padStart(8)}  1.00 40.00           N`);
    lines.push(`ATOM  ${(i + 2 * length).toString().padStart(5)}  C   ${resName} A${i.toString().padStart(4)}    ${x.toFixed(3).padStart(8)}${y.toFixed(3).padStart(8)}${(z + 1.0).toFixed(3).padStart(8)}  1.00 40.00           C`);
    lines.push(`ATOM  ${(i + 3 * length).toString().padStart(5)}  O   ${resName} A${i.toString().padStart(4)}    ${x.toFixed(3).padStart(8)}${y.toFixed(3).padStart(8)}${(z + 2.0).toFixed(3).padStart(8)}  1.00 40.00           O`);
  }

  lines.push('END');
  return lines.join('\n');
}

function generateMockSequence(length: number): string {
  const aa = 'ACDEFGHIKLMNPQRSTVWY';
  return Array.from({ length }, () => aa[Math.floor(Math.random() * aa.length)]).join('');
}

// Start server
app.listen(PORT, '127.0.0.1', () => {
  console.log(`Protein Design Backend running on http://127.0.0.1:${PORT}`);
  console.log(`Platform: ${process.platform}`);
  console.log(`Node version: ${process.version}`);
});
