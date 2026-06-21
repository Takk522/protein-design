import { useState } from 'react'
import { AppState } from '../App'

interface Props {
  state: AppState
  updateState: (updates: Partial<AppState>) => void
  addLog: (level: string, message: string) => void
}

type Tool = 'pdb' | 'chroma' | 'proteinmpnn' | 'esmfold' | 'rmsd'
type ChromaMode = 'unconditional' | 'symmetry' | 'shape' | 'compact' | 'substructure'

const CHROMA_MODES = [
  { id: 'unconditional', name: 'Unconditional', icon: '🧬', desc: 'Generate any protein by length' },
  { id: 'symmetry', name: 'Symmetry', icon: '🔄', desc: 'C2/C3/C4 symmetric structures' },
  { id: 'shape', name: 'Shape', icon: '🔤', desc: 'Letter-shaped structures' },
  { id: 'compact', name: 'Compact', icon: '⚪', desc: 'Rg-conditioned compact proteins' },
  { id: 'substructure', name: 'Substructure', icon: '🔗', desc: 'Motif-based design' }
]

export default function ToolPanel({ state, updateState, addLog }: Props) {
  const [activeTab, setActiveTab] = useState<Tool>('pdb')
  const [pdbId, setPdbId] = useState('')
  const [chromaMode, setChromaMode] = useState<ChromaMode>('unconditional')
  const [chromaLength, setChromaLength] = useState(100)
  const [chromaSymmetry, setChromaSymmetry] = useState(2)
  const [chromaShape, setChromaShape] = useState('A')
  const [chromaCompactness, setChromaCompactness] = useState(1.0)
  const [chromaSubstructureSelection, setChromaSubstructureSelection] = useState('all')
  const [mpnnTemperature, setMpnnTemperature] = useState(0.1)
  const [mpnnNumSeqs, setMpnnNumSeqs] = useState(1)
  const [esmSequenceInput, setEsmSequenceInput] = useState('')
  const [showSequences, setShowSequences] = useState(false)
  const [loading, setLoading] = useState(false)
  const [esmResults, setEsmResults] = useState<{pdb_content: string, sequence: string, rmsd?: number, aligned_pdb?: string}[]>([])
  const [rmsdLoading, setRmsdLoading] = useState(false)

  const fetchPdb = async () => {
    if (!pdbId.trim()) return
    setLoading(true)
    addLog('info', `Fetching PDB ${pdbId}...`)
    try {
      const res = await fetch('http://localhost:8000/api/pdb/fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pdb_id: pdbId })
      })
      const data = await res.json()
      if (res.ok) {
        updateState({ pdbContent: data.pdb_content })
        addLog('success', `Loaded PDB ${pdbId}: ${data.title}`)
      } else {
        addLog('error', `Failed to fetch PDB: ${data.detail}`)
      }
    } catch (e: any) {
      addLog('error', `Error: ${e.message}`)
    }
    setLoading(false)
  }

  const runChroma = async () => {
    setLoading(true)
    addLog('info', `Running Chroma (${chromaMode})...`)
    try {
      let endpoint = '/api/chroma/design'
      let body: any = { length: chromaLength }

      if (chromaMode === 'symmetry') {
        endpoint = '/api/chroma/symmetry'
        body = { length: chromaLength, symmetry_order: chromaSymmetry }
      } else if (chromaMode === 'shape') {
        endpoint = '/api/chroma/shape'
        body = { length: chromaLength, shape_letter: chromaShape }
      } else if (chromaMode === 'compact') {
        endpoint = '/api/chroma/compact'
        body = { length: chromaLength, rg_scale: chromaCompactness }
      } else if (chromaMode === 'substructure') {
        if (!state.pdbContent) {
          addLog('warning', 'Please fetch a PDB structure first for substructure mode')
          setLoading(false)
          return
        }
        endpoint = '/api/chroma/substructure'
        body = {
          pdb_content: state.pdbContent,
          selection: chromaSubstructureSelection
        }
      }

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 300000) // 5 min timeout

      const res = await fetch(`http://localhost:8000${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal
      })
      clearTimeout(timeoutId)
      const data = await res.json()
      if (res.ok) {
        updateState({ backboneContent: data.pdb_content })
        addLog('success', `Chroma generated backbone (${data.pdb_content.split('\n').length} atoms)`)
      } else {
        addLog('error', `Chroma failed: ${data.detail}`)
      }
    } catch (e: any) {
      addLog('error', `Error: ${e.message}`)
    }
    setLoading(false)
  }

  const runProteinMPNN = async () => {
    if (!state.backboneContent) {
      addLog('warning', 'No backbone structure loaded')
      return
    }
    setLoading(true)
    addLog('info', `Running ProteinMPNN (${mpnnNumSeqs} sequences)...`)
    try {
      const res = await fetch('http://localhost:8000/api/proteinmpnn/design', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pdb_content: state.backboneContent,
          num_sequences: mpnnNumSeqs,
          temperature: mpnnTemperature
        })
      })
      const data = await res.json()
      if (res.ok) {
        updateState({ sequences: data.sequences })
        addLog('success', `Generated ${data.sequences.length} sequences`)
      } else {
        addLog('error', `ProteinMPNN failed: ${data.detail}`)
      }
    } catch (e: any) {
      addLog('error', `Error: ${e.message}`)
    }
    setLoading(false)
  }

  const runESMFold = async (sequence?: string) => {
    const targetSeq = sequence || esmSequenceInput || state.sequences[0]
    if (!targetSeq) {
      addLog('warning', 'No sequence to predict')
      return
    }
    setLoading(true)
    addLog('info', 'Running ESMFold prediction...')
    try {
      const res = await fetch('http://localhost:8000/api/esmfold/predict', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sequence: targetSeq })
      })
      const data = await res.json()
      if (res.ok) {
        const newResult = { pdb_content: data.pdb_content, sequence: targetSeq }
        const resultsWithRmsd = [...esmResults, newResult]
        setEsmResults(resultsWithRmsd)
        updateState({ predictedStructures: [...state.predictedStructures, data.pdb_content] })
        addLog('success', `ESMFold predicted structure (${data.length} residues)`)
      } else {
        addLog('error', `ESMFold failed: ${data.detail}`)
      }
    } catch (e: any) {
      addLog('error', `Error: ${e.message}`)
    }
    setLoading(false)
  }

  const runRMSD = async (index: number) => {
    if (!state.backboneContent) {
      addLog('warning', 'No backbone structure to compare')
      return
    }
    setRmsdLoading(true)
    try {
      const res = await fetch('http://localhost:8000/api/rmsd/calculate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pdb1: state.backboneContent,
          pdb2: esmResults[index].pdb_content
        })
      })
      const data = await res.json()
      if (res.ok) {
        // Store aligned PDB as the new pdb_content (replacing original)
        const newResults = [...esmResults]
        newResults[index] = {
          ...newResults[index],
          rmsd: data.rmsd_aligned,
          pdb_content: data.aligned_pdb2  // Replace original with aligned
        }
        setEsmResults(newResults)

        // Update predicted structure with aligned version
        const newPredictedStructures = [...state.predictedStructures]
        newPredictedStructures[index] = data.aligned_pdb2
        updateState({
          predictedStructures: newPredictedStructures,
          alignedStructures: []  // Clear aligned structures since we replaced original
        })

        addLog('success', `RMSD: ${data.rmsd_aligned.toFixed(2)} Å (aligned)`)
      } else {
        addLog('error', `RMSD calculation failed: ${data.detail}`)
      }
    } catch (e: any) {
      addLog('error', `Error: ${e.message}`)
    }
    setRmsdLoading(false)
  }

  const copySequence = (seq: string) => {
    navigator.clipboard.writeText(seq)
    addLog('info', 'Sequence copied to clipboard')
  }

  return (
    <>
      <div className="panel-tabs">
        {(['pdb', 'chroma', 'proteinmpnn', 'esmfold', 'rmsd'] as Tool[]).map(tool => (
          <button
            key={tool}
            className={`panel-tab ${activeTab === tool ? 'active' : ''}`}
            onClick={() => setActiveTab(tool)}
          >
            {tool.toUpperCase()}
          </button>
        ))}
      </div>

      <div className="panel-content">
        {activeTab === 'pdb' && (
          <div className="panel-section">
            <div className="panel-section-title">Fetch PDB Structure</div>
            <div className="form-group">
              <label className="form-label">PDB ID (e.g., 1ABC)</label>
              <div className="input-group">
                <input
                  type="text"
                  className="form-input"
                  value={pdbId}
                  onChange={e => setPdbId(e.target.value.toUpperCase())}
                  placeholder="1CRN"
                  onKeyDown={e => e.key === 'Enter' && fetchPdb()}
                />
                <button className="btn btn-primary" onClick={fetchPdb} disabled={loading}>
                  Fetch
                </button>
              </div>
            </div>
            {state.pdbContent && (
              <div className="result-card">
                <div className="result-card-header">
                  <span className="result-card-title">{pdbId}</span>
                  <span className="badge green">Loaded</span>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'chroma' && (
          <div className="panel-section">
            <div className="panel-section-title">Chroma Design Modes</div>
            <div className="mode-grid">
              {CHROMA_MODES.map(mode => (
                <div
                  key={mode.id}
                  className={`mode-card ${chromaMode === mode.id ? 'selected' : ''}`}
                  onClick={() => setChromaMode(mode.id as ChromaMode)}
                >
                  <div className="mode-card-icon">{mode.icon}</div>
                  <div className="mode-card-title">{mode.name}</div>
                  <div className="mode-card-desc">{mode.desc}</div>
                </div>
              ))}
            </div>

            <div className="form-group">
              <label className="form-label">Length: {chromaLength}</label>
              <div className="form-slider-container">
                <input
                  type="range"
                  className="form-slider"
                  min={50}
                  max={500}
                  value={chromaLength}
                  onChange={e => setChromaLength(Number(e.target.value))}
                />
                <span className="form-slider-value">{chromaLength}</span>
              </div>
            </div>

            {chromaMode === 'symmetry' && (
              <div className="form-group">
                <label className="form-label">Symmetry Order: {chromaSymmetry}</label>
                <div className="form-slider-container">
                  <input
                    type="range"
                    className="form-slider"
                    min={2}
                    max={4}
                    value={chromaSymmetry}
                    onChange={e => setChromaSymmetry(Number(e.target.value))}
                  />
                  <span className="form-slider-value">C{chromaSymmetry}</span>
                </div>
              </div>
            )}

            {chromaMode === 'shape' && (
              <div className="form-group">
                <label className="form-label">Shape Letter</label>
                <select className="form-select" value={chromaShape} onChange={e => setChromaShape(e.target.value)}>
                  {['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'].map(l => (
                    <option key={l} value={l}>{l}</option>
                  ))}
                </select>
              </div>
            )}

            {chromaMode === 'compact' && (
              <div className="form-group">
                <label className="form-label">Compactness (Rg scale): {chromaCompactness.toFixed(1)}</label>
                <div className="form-slider-container">
                  <input
                    type="range"
                    className="form-slider"
                    min={0.5}
                    max={2.0}
                    step={0.1}
                    value={chromaCompactness}
                    onChange={e => setChromaCompactness(Number(e.target.value))}
                  />
                </div>
              </div>
            )}

            {chromaMode === 'substructure' && (
              <div className="form-group">
                <label className="form-label">Selection (PyMOL style, e.g., resid 1-10 around 5.0)</label>
                <input
                  type="text"
                  className="form-input"
                  value={chromaSubstructureSelection}
                  onChange={e => setChromaSubstructureSelection(e.target.value)}
                  placeholder="all"
                />
              </div>
            )}

            <button className="btn btn-primary btn-full" onClick={runChroma} disabled={loading}>
              {loading ? 'Generating...' : 'Generate Backbone'}
            </button>
          </div>
        )}

        {activeTab === 'proteinmpnn' && (
          <div className="panel-section">
            <div className="panel-section-title">ProteinMPNN Sequence Design</div>
            <div className="form-group">
              <label className="form-label">Temperature: {mpnnTemperature}</label>
              <div className="form-slider-container">
                <input
                  type="range"
                  className="form-slider"
                  min={0.01}
                  max={1.0}
                  step={0.01}
                  value={mpnnTemperature}
                  onChange={e => setMpnnTemperature(Number(e.target.value))}
                />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Number of Sequences: {mpnnNumSeqs}</label>
              <div className="form-slider-container">
                <input
                  type="range"
                  className="form-slider"
                  min={1}
                  max={10}
                  value={mpnnNumSeqs}
                  onChange={e => setMpnnNumSeqs(Number(e.target.value))}
                />
                <span className="form-slider-value">{mpnnNumSeqs}</span>
              </div>
            </div>
            <button
              className="btn btn-primary btn-full"
              onClick={runProteinMPNN}
              disabled={loading || !state.backboneContent}
            >
              {loading ? 'Designing...' : 'Design Sequences'}
            </button>
            {!state.backboneContent && (
              <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
                Run Chroma first to generate a backbone
              </p>
            )}

            {state.sequences.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <button
                  className="btn btn-secondary btn-full"
                  onClick={() => setShowSequences(!showSequences)}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
                >
                  {showSequences ? '▼' : '▶'} Sequences ({state.sequences.length})
                </button>

                {showSequences && (
                  <div style={{ marginTop: 12 }}>
                    {state.sequences.map((seq, i) => (
                      <div key={i} style={{
                        background: 'var(--bg-secondary)',
                        borderRadius: 6,
                        padding: 10,
                        marginBottom: 8
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Seq {i + 1}</span>
                          <button
                            className="btn btn-secondary"
                            style={{ padding: '2px 8px', fontSize: 10 }}
                            onClick={() => {
                              navigator.clipboard.writeText(seq)
                              addLog('info', `Copied sequence ${i + 1}`)
                            }}
                          >
                            Copy
                          </button>
                        </div>
                        <div style={{
                          fontFamily: 'monospace',
                          fontSize: 12,
                          wordBreak: 'break-all',
                          marginTop: 6,
                          color: 'var(--text-primary)'
                        }}>
                          {seq}
                        </div>
                        <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 4 }}>
                          {seq.length} amino acids
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {activeTab === 'esmfold' && (
          <div className="panel-section">
            <div className="panel-section-title">ESMFold Structure Prediction</div>

            {state.sequences.length > 0 && (
              <div className="form-group">
                <label className="form-label">Use ProteinMPNN sequence</label>
                <select
                  className="form-select"
                  value={esmSequenceInput}
                  onChange={e => setEsmSequenceInput(e.target.value)}
                  style={{ marginBottom: 8 }}
                >
                  <option value="">-- Select a sequence --</option>
                  {state.sequences.map((seq, i) => (
                    <option key={i} value={seq}>Seq {i + 1} ({seq.length} aa)</option>
                  ))}
                </select>
              </div>
            )}

            <div className="form-group">
              <label className="form-label">Or enter custom sequence</label>
              <textarea
                className="form-input"
                value={esmSequenceInput}
                onChange={e => setEsmSequenceInput(e.target.value)}
                placeholder="MVITEEEKKKIEEYRKKLQEALDRLKANSPDFEDILKEAKKVAEEMRKISPEAGKLAEDYLKQIEELIKKRKA"
                rows={3}
                style={{ resize: 'vertical', fontFamily: 'monospace', fontSize: 11 }}
              />
              {esmSequenceInput && (
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
                  {esmSequenceInput.length} characters
                </div>
              )}
            </div>

            <button
              className="btn btn-primary btn-full"
              onClick={() => runESMFold()}
              disabled={loading || (!esmSequenceInput && state.sequences.length === 0)}
            >
              {loading ? 'Predicting...' : 'Predict Structure'}
            </button>

            {esmResults.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 8 }}>
                  Predictions
                </div>
                {esmResults.map((result, i) => (
                  <div key={i} style={{
                    background: 'var(--bg-secondary)',
                    borderRadius: 6,
                    padding: 10,
                    marginBottom: 8
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                        Prediction {i + 1}
                      </span>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button
                          className="btn btn-secondary"
                          style={{ padding: '2px 6px', fontSize: 9 }}
                          onClick={() => copySequence(result.sequence)}
                        >
                          Copy
                        </button>
                        <button
                          className="btn btn-secondary"
                          style={{ padding: '2px 6px', fontSize: 9 }}
                          onClick={() => runRMSD(i)}
                          disabled={rmsdLoading || !state.backboneContent}
                        >
                          Align & RMSD
                        </button>
                      </div>
                    </div>
                    <div style={{
                      fontFamily: 'monospace',
                      fontSize: 10,
                      wordBreak: 'break-all',
                      color: 'var(--text-muted)',
                      maxHeight: 40,
                      overflow: 'hidden'
                    }}>
                      {result.sequence}
                    </div>
                    {result.rmsd !== undefined && (
                      <div style={{
                        fontSize: 11,
                        color: result.rmsd < 5 ? 'var(--color-success)' : 'var(--color-warning)',
                        marginTop: 6,
                        fontWeight: 500
                      }}>
                        RMSD vs backbone: {result.rmsd.toFixed(2)} Å
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'rmsd' && (
          <div className="panel-section">
            <div className="panel-section-title">RMSD Calculation</div>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12 }}>
              Calculate RMSD between two structures using CA atoms.
            </p>
            <button
              className="btn btn-primary btn-full"
              onClick={() => addLog('info', 'Load two structures in viewer to calculate RMSD')}
              disabled={state.predictedStructures.length < 1}
            >
              Calculate RMSD
            </button>
          </div>
        )}
      </div>
    </>
  )
}