import { useState, useEffect } from 'react'
import ToolPanel from './components/ToolPanel'
import ViewerPanel from './components/ViewerPanel'
import WorkflowPanel from './components/WorkflowPanel'
import ConsolePanel from './components/ConsolePanel'

export interface AppState {
  currentTool: 'pdb' | 'chroma' | 'proteinmpnn' | 'esmfold' | 'rmsd'
  pdbContent: string | null
  backboneContent: string | null
  sequences: string[]
  predictedStructures: string[]
  alignedStructures: { prediction_index: number; aligned_pdb: string; rmsd: number }[]
  rmsdResults: { simple: number; aligned: number } | null
  consoleLogs: { level: string; message: string; timestamp: Date }[]
}

function App() {
  const [serverStatus, setServerStatus] = useState<'checking' | 'online' | 'offline'>('checking')
  const [consoleLogs, setConsoleLogs] = useState<AppState['consoleLogs']>([])
  const [state, setState] = useState<AppState>({
    currentTool: 'pdb',
    pdbContent: null,
    backboneContent: null,
    sequences: [],
    predictedStructures: [],
    alignedStructures: [],
    rmsdResults: null,
    consoleLogs: []
  })

  const addLog = (level: string, message: string) => {
    const timestamp = new Date()
    setConsoleLogs(prev => [...prev, { level, message, timestamp }])
    setState(prev => ({ ...prev, consoleLogs: [...prev.consoleLogs, { level, message, timestamp }] }))
  }

  useEffect(() => {
    let attempts = 0
    const maxAttempts = 10

    const checkServer = async () => {
      try {
        const response = await fetch('http://localhost:8000/health')
        if (response.ok) {
          setServerStatus('online')
          addLog('success', 'Backend server connected')
          return true
        } else {
          setServerStatus('offline')
          addLog('error', `Backend server error: ${response.status}`)
          return false
        }
      } catch {
        setServerStatus('offline')
        if (attempts < 3) {
          addLog('error', 'Backend server offline - retrying...')
        }
        return false
      }
    }

    const check = async () => {
      const online = await checkServer()
      if (!online && attempts < maxAttempts) {
        attempts++
        setTimeout(check, 1500)
      }
    }

    check()
  }, [])

  const updateState = (updates: Partial<AppState>) => {
    setState(prev => ({ ...prev, ...updates }))
  }

  return (
    <div className="app-container">
      <header className="header">
        <div className="header-title">Protein Design Studio</div>
        <div className="header-status">
          <div className="status-indicator">
            <span className={`status-dot ${serverStatus === 'online' ? '' : serverStatus === 'checking' ? 'warning' : 'error'}`}></span>
            <span>Server: {serverStatus}</span>
          </div>
        </div>
      </header>

      <div className="main-content">
        <div className="left-panel">
          <ToolPanel state={state} updateState={updateState} addLog={addLog} />
        </div>

        <div className="center-panel">
          <ViewerPanel state={state} addLog={addLog} />
          <ConsolePanel logs={consoleLogs} />
        </div>

        <div className="right-panel">
          <WorkflowPanel state={state} addLog={addLog} />
        </div>
      </div>
    </div>
  )
}

export default App