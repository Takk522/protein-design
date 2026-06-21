interface LogEntry {
  level: string
  message: string
  timestamp: Date
}

interface Props {
  logs: LogEntry[]
}

export default function ConsolePanel({ logs }: Props) {
  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })
  }

  return (
    <div className="console-container">
      <div className="console-header">
        <span className="console-title">Console Output</span>
        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
          {logs.length} entries
        </span>
      </div>
      <div className="console-output">
        {logs.length === 0 ? (
          <div className="console-line info">No output yet...</div>
        ) : (
          logs.map((log, i) => (
            <div key={i} className={`console-line ${log.level}`}>
              <span style={{ color: 'var(--text-muted)' }}>[{formatTime(log.timestamp)}]</span>{' '}
              {log.message}
            </div>
          ))
        )}
      </div>
    </div>
  )
}