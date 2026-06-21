import { useState } from 'react'
import JSZip from 'jszip'
import { AppState } from '../App'

interface Props {
  state: AppState
  addLog: (level: string, message: string) => void
}

export default function ResultPanel({ state, addLog }: Props) {
  const [expandedSeq, setExpandedSeq] = useState<number | null>(null)

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
    addLog('info', 'Copied to clipboard')
  }

  const copyAllSequences = () => {
    const allSeqs = state.sequences.map((seq, i) => `>Seq_${i + 1}_length_${seq.length}\n${seq}`).join('\n')
    navigator.clipboard.writeText(allSeqs)
    addLog('success', `Copied ${state.sequences.length} sequences to clipboard`)
  }

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
  }

  const downloadAll = async () => {
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

  return (
    <>
      <div className="panel-tabs">
        <button className="panel-tab active">Results</button>
      </div>

      <div className="panel-content">
        <div className="panel-section">
          <div className="panel-section-title">
            Generated Sequences
            {state.sequences.length > 0 && (
              <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 8 }}>
                ({state.sequences.length} sequences)
              </span>
            )}
          </div>
          {state.sequences.length > 1 && (
            <button
              className="btn btn-secondary btn-full"
              style={{ marginBottom: 12, fontSize: 12 }}
              onClick={copyAllSequences}
            >
              Copy All Sequences
            </button>
          )}
          {state.sequences.length === 0 ? (
            <div className="empty-state" style={{ height: 'auto', padding: 20 }}>
              <div className="empty-state-text">No sequences yet</div>
            </div>
          ) : (
            state.sequences.map((seq, i) => (
              <div key={i} className="result-card">
                <div className="result-card-header">
                  <span className="result-card-title">Sequence {i + 1}</span>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                    {seq.length} aa
                  </span>
                </div>
                <div
                  className="result-card-sequence"
                  style={{
                    maxHeight: expandedSeq === i ? 'none' : '60px',
                    overflow: expandedSeq === i ? 'visible' : 'hidden',
                    cursor: 'pointer',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all'
                  }}
                  onClick={() => setExpandedSeq(expandedSeq === i ? null : i)}
                  title="Click to expand/collapse"
                >
                  {seq}
                </div>
                <button
                  className="btn btn-secondary"
                  style={{ padding: '4px 8px', fontSize: 10, marginTop: 4 }}
                  onClick={(e) => { e.stopPropagation(); copyToClipboard(seq); }}
                >
                  {expandedSeq === i ? 'Collapse' : 'Copy'}
                </button>
              </div>
            ))
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
                Download ESMFold Prediction {i + 1}
              </button>
            )
          })}

          {(state.pdbContent || state.backboneContent || state.predictedStructures.length > 0) && (
            <>
              <button
                className="btn btn-primary btn-full"
                style={{ marginTop: 8 }}
                onClick={downloadAll}
              >
                Download All as ZIP
              </button>
            </>
          )}
        </div>
      </div>
    </>
  )
}