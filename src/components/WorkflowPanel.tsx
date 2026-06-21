import JSZip from 'jszip'
import { AppState } from '../App'

interface Props {
  state: AppState
  addLog: (level: string, message: string) => void
}

export default function WorkflowPanel({ state, addLog }: Props) {
  const steps = [
    {
      id: 1,
      title: 'PDB Fetch',
      description: 'Fetch structure from RCSB',
      status: state.pdbContent ? 'completed' : 'pending',
      icon: '📥'
    },
    {
      id: 2,
      title: 'Backbone Design',
      description: 'Chroma generation',
      status: state.backboneContent ? 'completed' : 'pending',
      icon: '🔧'
    },
    {
      id: 3,
      title: 'Sequence Design',
      description: 'ProteinMPNN',
      status: state.sequences.length > 0 ? 'completed' : 'pending',
      icon: '🧬'
    },
    {
      id: 4,
      title: 'Structure Prediction',
      description: 'ESMFold',
      status: state.predictedStructures.length > 0 ? 'completed' : 'pending',
      icon: '🔮'
    },
    {
      id: 5,
      title: 'Analysis',
      description: 'RMSD calculation',
      status: state.rmsdResults ? 'completed' : 'pending',
      icon: '📊'
    }
  ]

  const downloadFile = (content: string, filename: string) => {
    const blob = new Blob([content], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 100)
    addLog('info', `Downloaded ${filename}`)
  }

  const downloadAll = async () => {
    if (!state.pdbContent && !state.backboneContent && state.predictedStructures.length === 0) {
      addLog('warning', 'No PDB files to download')
      return
    }

    const zip = new JSZip()

    if (state.pdbContent) {
      zip.file('01_fetched.pdb', state.pdbContent)
    }
    if (state.backboneContent) {
      zip.file('02_chroma_backbone.pdb', state.backboneContent)
    }
    state.predictedStructures.forEach((struct, i) => {
      const num = (i + 3).toString().padStart(2, '0')
      zip.file(`${num}_esmfold_prediction_${i + 1}.pdb`, struct)
    })

    try {
      const content = await zip.generateAsync({ type: 'blob' })
      const url = URL.createObjectURL(content)
      const a = document.createElement('a')
      a.href = url
      a.download = 'protein_design_results.zip'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(url), 100)
      addLog('success', 'Downloaded all PDB files as zip')
    } catch (e) {
      addLog('error', 'Failed to create zip file')
    }
  }

  const downloadSequences = () => {
    state.sequences.forEach((seq, i) => {
      const blob = new Blob([seq], { type: 'text/plain' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `sequence_${i + 1}.txt`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(url), 100)
    })
    addLog('info', `Downloaded ${state.sequences.length} sequences`)
  }

  return (
    <>
      <div className="panel-tabs">
        <button className="panel-tab active">Workflow</button>
      </div>

      <div className="panel-content">
        <div className="panel-section">
          <div className="panel-section-title">Pipeline Status</div>
          {steps.map(step => (
            <div key={step.id} className="workflow-step">
              <div className="step-number">{step.id}</div>
              <div className="step-content">
                <div className="step-title">
                  <span style={{ marginRight: 8 }}>{step.icon}</span>
                  {step.title}
                </div>
                <div className="step-description">{step.description}</div>
              </div>
              <div className={`step-status ${step.status === 'completed' ? 'completed' : step.status === 'running' ? 'running' : 'pending'}`}>
                {step.status === 'completed' ? '✓' : step.status === 'running' ? '⟳' : '○'}
              </div>
            </div>
          ))}
        </div>

        <div className="panel-section">
          <div className="panel-section-title">Results</div>
          {state.sequences.length > 0 && (
            <div className="result-card">
              <div className="result-card-header">
                <span className="result-card-title">Sequences</span>
                <span className="badge blue">{state.sequences.length}</span>
              </div>
              {state.sequences.slice(0, 2).map((seq, i) => (
                <div key={i} className="result-card-sequence" style={{ marginBottom: 4 }}>
                  {seq.substring(0, 60)}{seq.length > 60 ? '...' : ''}
                </div>
              ))}
              {state.sequences.length > 2 && (
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  +{state.sequences.length - 2} more sequences
                </div>
              )}
            </div>
          )}

          {state.predictedStructures.length > 0 && (
            <div className="result-card">
              <div className="result-card-header">
                <span className="result-card-title">Predictions</span>
                <span className="badge green">{state.predictedStructures.length}</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                {state.predictedStructures.length} structure(s) predicted
              </div>
            </div>
          )}

          {state.rmsdResults && (
            <div className="result-card">
              <div className="result-card-header">
                <span className="result-card-title">RMSD</span>
                <span className="badge yellow">Calculated</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-primary)', marginTop: 6 }}>
                Simple: <span style={{ color: 'var(--accent-blue)' }}>{state.rmsdResults.simple.toFixed(2)} Å</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-primary)' }}>
                Aligned: <span style={{ color: 'var(--accent-green)' }}>{state.rmsdResults.aligned.toFixed(2)} Å</span>
              </div>
            </div>
          )}
        </div>

        <div className="panel-section">
          <div className="panel-section-title">Download PDB Files</div>

          {state.pdbContent && (
            <button
              className="btn btn-secondary btn-full"
              style={{ marginBottom: 8 }}
              onClick={() => downloadFile(state.pdbContent!, '01_fetched.pdb')}
            >
              Download Fetched PDB
            </button>
          )}

          {state.backboneContent && (
            <button
              className="btn btn-secondary btn-full"
              style={{ marginBottom: 8 }}
              onClick={() => downloadFile(state.backboneContent!, '02_chroma_backbone.pdb')}
            >
              Download Chroma Backbone
            </button>
          )}

          {state.predictedStructures.map((struct, i) => {
            const num = (i + 3).toString().padStart(2, '0')
            return (
              <button
                key={i}
                className="btn btn-secondary btn-full"
                style={{ marginBottom: 8 }}
                onClick={() => downloadFile(struct, `${num}_esmfold_prediction_${i + 1}.pdb`)}
              >
                Download ESMFold {i + 1}
              </button>
            )
          })}

          {(state.pdbContent || state.backboneContent || state.predictedStructures.length > 0) && (
            <button
              className="btn btn-primary btn-full"
              style={{ marginTop: 8 }}
              onClick={downloadAll}
            >
              Download All as ZIP
            </button>
          )}

          {state.sequences.length > 0 && (
            <button
              className="btn btn-secondary btn-full"
              style={{ marginTop: 12 }}
              onClick={downloadSequences}
            >
              Download All Sequences
            </button>
          )}
        </div>
      </div>
    </>
  )
}