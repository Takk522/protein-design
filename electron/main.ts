import { app, BrowserWindow, ipcMain, shell } from 'electron'
import path from 'path'
import { fileURLToPath } from 'url'
import log from 'electron-log'
import { startServer, stopServer } from './server'
import { spawn, ChildProcess } from 'child_process'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Setup logging first - before anything else
log.transports.file.level = 'info'
log.transports.console.level = 'debug'

// Catch startup errors
process.on('uncaughtException', (error) => {
  console.error('[CRASH] Uncaught exception at startup:', error)
  log.error('[CRASH] Uncaught exception at startup:', error)
})

process.on('unhandledRejection', (reason, promise) => {
  console.error('[CRASH] Unhandled rejection at startup:', reason)
  log.error('[CRASH] Unhandled rejection at startup:', reason)
})

log.info('[MAIN] Application starting, isPackaged:', app.isPackaged)
log.info('[MAIN] Platform:', process.platform)
log.info('[MAIN] Resources path:', process.resourcesPath)
log.info('[MAIN] CWD:', process.cwd())

let mainWindow: BrowserWindow | null = null
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged
let viteProcess: ChildProcess | null = null

function createWindow() {
  log.info('[CREATE_WINDOW] Creating main window...')

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    title: 'Protein Design Studio',
    backgroundColor: '#0F172A',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    },
    show: false
  })

  mainWindow.once('ready-to-show', () => {
    log.info('Window ready to show')
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (isDev) {
    log.info('Loading development server...')
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools()
  } else {
    log.info('Loading production build...')
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.on('closed', () => {
    log.info('Window closed')
    mainWindow = null
  })
}

function getProjectRoot(): string {
  // In development: electron/main.ts -> protein-design/
  // In production: dist-electron/main.js -> protein-design/
  // Use app.getAppPath() to get the correct root
  return app.getAppPath()
}

async function startVite(): Promise<void> {
  return new Promise((resolve, reject) => {
    const projectRoot = getProjectRoot()
    const viteScript = path.join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js')
    log.info(`Starting Vite dev server: node ${viteScript}...`)
    log.info(`Project root: ${projectRoot}`)
    viteProcess = spawn('node', [viteScript, '--port', '5173'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true,
      cwd: projectRoot,
      env: { ...process.env, NODE_ENV: 'development' }
    })

    let resolved = false
    viteProcess.stdout?.on('data', (data) => {
      const output = data.toString()
      log.info(`Vite: ${output}`)
      if (output.includes('Local:') && !resolved) {
        resolved = true
        resolve()
      }
    })
    viteProcess.stderr?.on('data', (data) => {
      log.info(`Vite stderr: ${data.toString()}`)
    })
    viteProcess.on('error', (error) => {
      log.error(`Vite error: ${error}`)
      reject(error)
    })
    viteProcess.on('exit', (code) => {
      log.info(`Vite exited with code ${code}`)
      viteProcess = null
    })
    setTimeout(() => {
      if (!resolved) {
        resolved = true
        resolve()
      }
    }, 10000)
  })
}

async function startBackend() {
  try {
    log.info('Starting backend server...')
    await startServer()
    log.info('Backend server started successfully')
  } catch (error: any) {
    const errorMsg = error?.message || String(error)
    log.error('Failed to start backend:', errorMsg)
    // Don't show dialog - just log the error
  }
}

app.whenReady().then(async () => {
  log.info('[STARTUP] App ready fired')
  try {
    if (isDev) {
      log.info('[STARTUP] Starting Vite...')
      await startVite()
      log.info('[STARTUP] Vite started')
    } else {
      log.info('[STARTUP] Production mode - skipping Vite')
    }
  } catch (error) {
    log.error('[STARTUP] Failed to start dev server:', error)
  }

  try {
    log.info('[STARTUP] Starting backend...')
    await startBackend()
    log.info('[STARTUP] Backend started')
  } catch (error) {
    log.error('[STARTUP] Failed to start backend:', error)
  }

  log.info('[STARTUP] Creating window...')
  createWindow()
  log.info('[STARTUP] Window creation initiated')

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
}).catch((error) => {
  log.error('[STARTUP] Uncaught error in app.whenReady():', error)
})

app.on('window-all-closed', () => {
  log.info('All windows closed')
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', async () => {
  log.info('App quitting...')
  if (viteProcess) {
    viteProcess.kill()
    viteProcess = null
  }
  await stopServer()
})

process.on('uncaughtException', (error) => {
  log.error('Uncaught exception:', error)
})

process.on('unhandledRejection', (reason, promise) => {
  log.error('Unhandled rejection at:', promise, 'reason:', reason)
})

ipcMain.handle('get-app-version', () => app.getVersion())
ipcMain.handle('get-platform', () => process.platform)
