import { useEffect, useRef, useState } from 'react'
import $3Dmol from '3dmol'
import { AppState } from '../App'

interface Props {
  state: AppState
  addLog: (level: string, message: string) => void
}

type RenderMode = 'cartoon' | 'stick' | 'sphere' | 'surface'

interface StructureEntry {
  id: string
  name: string
  content: string
  color: string
}

export default function ViewerPanel({ state, addLog }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<any>(null)
  const [renderMode, setRenderMode] = useState<RenderMode>('cartoon')
  const [spin, setSpin] = useState(false)
  const [visibleStructures, setVisibleStructures] = useState<Set<string>>(new Set(['backbone', 'fetched']))
  const [showStructureList, setShowStructureList] = useState(false)

  // Distinct colors for structures
  const structureColors = [
    '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
    '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9'
  ]

  // Build list of available structures
  const structures: StructureEntry[] = [
    ...(state.pdbContent ? [{
      id: 'fetched',
      name: 'Fetched PDB',
      content: state.pdbContent,
      color: '#888888'
    }] : []),
    ...(state.backboneContent ? [{
      id: 'backbone',
      name: 'Chroma Backbone',
      content: state.backboneContent,
      color: '#00ff00'
    }] : []),
    ...(state.predictedStructures.map((struct, i) => ({
      id: `prediction_${i}`,
      name: `ESMFold ${i + 1}`,
      content: struct,
      color: structureColors[i % structureColors.length]
    }))),
    // Add aligned structures
    ...(state.alignedStructures.map((aligned) => ({
      id: `aligned_${aligned.prediction_index}`,
      name: `Aligned ${aligned.prediction_index + 1} (RMSD: ${aligned.rmsd.toFixed(2)} Å)`,
      content: aligned.aligned_pdb,
      color: '#FFFF00'  // Yellow for aligned
    })))
  ]

  useEffect(() => {
    if (!containerRef.current) return

    const viewer = $3Dmol.createViewer(containerRef.current, {
      backgroundColor: '#0F172A'
    })
    viewerRef.current = viewer

    return () => {
      viewer.clear()
    }
  }, [])

  useEffect(() => {
    if (!viewerRef.current) return
    const viewer = viewerRef.current
    viewer.clear()

    // Add visible structures with distinct colors
    for (const struct of structures) {
      if (visibleStructures.has(struct.id)) {
        const modelIndex = viewer.addModel(struct.content, 'pdb')
        viewer.setStyle({ model: modelIndex }, { [renderMode]: { color: struct.color, opacity: 0.85 } })
      }
    }

    viewer.zoomTo()
    viewer.render()
    addLog('info', `Viewer: ${visibleStructures.size} structures shown`)
  }, [state.pdbContent, state.backboneContent, state.predictedStructures, state.alignedStructures, visibleStructures, renderMode])

  const toggleStructure = (id: string) => {
    const newVisible = new Set(visibleStructures)
    if (newVisible.has(id)) {
      newVisible.delete(id)
    } else {
      newVisible.add(id)
    }
    setVisibleStructures(newVisible)
  }

  const showAll = () => {
    setVisibleStructures(new Set(structures.map(s => s.id)))
  }

  const hideAll = () => {
    setVisibleStructures(new Set())
  }

  const toggleSpin = () => {
    if (!viewerRef.current) return
    if (spin) {
      viewerRef.current.stopAnimate()
    } else {
      viewerRef.current.animate({})
    }
    setSpin(!spin)
  }

  const handleResetView = () => {
    if (!viewerRef.current) return
    viewerRef.current.zoomTo()
    viewerRef.current.render()
  }

  const handleCenter = () => {
    if (!viewerRef.current) return
    viewerRef.current.center()
    viewerRef.current.zoomTo()
    viewerRef.current.render()
  }

  return (
    <div className="viewer-container">
      <div ref={containerRef} className="viewer-canvas" />

      <div className="viewer-controls">
        <button className="viewer-control-btn" onClick={handleResetView}>Reset</button>
        <button className="viewer-control-btn" onClick={handleCenter}>Center</button>
        <button className={`viewer-control-btn ${spin ? 'active' : ''}`} onClick={toggleSpin}>
          {spin ? 'Stop' : 'Spin'}
        </button>

        <select
          className="viewer-control-btn"
          value={renderMode}
          onChange={e => setRenderMode(e.target.value as RenderMode)}
          style={{ cursor: 'pointer' }}
        >
          <option value="cartoon">Cartoon</option>
          <option value="stick">Stick</option>
          <option value="sphere">Sphere</option>
          <option value="surface">Surface</option>
        </select>

        <button
          className={`viewer-control-btn ${showStructureList ? 'active' : ''}`}
          onClick={() => setShowStructureList(!showStructureList)}
          style={{ minWidth: 80 }}
        >
          Structures
        </button>
      </div>

      {showStructureList && structures.length > 0 && (
        <div style={{
          position: 'absolute',
          top: 50,
          right: 10,
          background: 'var(--bg-secondary)',
          borderRadius: 8,
          padding: 12,
          zIndex: 100,
          minWidth: 200,
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
        }}>
          <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 8 }}>Structures</div>

          <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
            <button
              className="btn btn-secondary"
              style={{ padding: '2px 8px', fontSize: 10, flex: 1 }}
              onClick={showAll}
            >
              All
            </button>
            <button
              className="btn btn-secondary"
              style={{ padding: '2px 8px', fontSize: 10, flex: 1 }}
              onClick={hideAll}
            >
              None
            </button>
          </div>

          {structures.map(struct => (
            <div
              key={struct.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '4px 0',
                cursor: 'pointer',
                opacity: visibleStructures.has(struct.id) ? 1 : 0.5
              }}
              onClick={() => toggleStructure(struct.id)}
            >
              <div style={{
                width: 12,
                height: 12,
                borderRadius: 2,
                background: struct.color,
                border: visibleStructures.has(struct.id) ? '2px solid white' : '2px solid transparent'
              }} />
              <span style={{ fontSize: 11 }}>{struct.name}</span>
            </div>
          ))}
        </div>
      )}

      {structures.length === 0 && (
        <div className="empty-state">
          <div className="empty-state-icon">🧬</div>
          <div className="empty-state-text">
            Fetch a PDB or generate a backbone to visualize
          </div>
        </div>
      )}
    </div>
  )
}