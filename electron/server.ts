/**
 * Backend server for Protein Design Studio
 * Downloads and runs Python backend exe on Windows
 * Uses bundled Node.js server on Mac
 */

import path from 'path'
import { fileURLToPath } from 'url'
import log from 'electron-log'
import http from 'http'
import { app } from 'electron'
import { spawn, ChildProcess } from 'child_process'
import https from 'https'
import http2 from 'http'
import fs from 'fs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const RELEASE_URL = 'https://github.com/Takk522/protein-design/releases/download/v1.0.12/ProteinDesignBackend.exe'
const HEALTH_CHECK_URL = 'http://127.0.0.1:8000/health'
const MAX_WAIT_MS = 120000 // 2 minutes

let backendProcess: ChildProcess | null = null

export async function startServer(): Promise<void> {
  const isPackaged = app.isPackaged
  const isWindows = process.platform === 'win32'

  log.info(`[Server] Platform: ${process.platform}, isPackaged: ${isPackaged}`)

  if (isWindows) {
    await startWindowsBackend()
  } else {
    await startMacBackend()
  }
}

async function startWindowsBackend(): Promise<void> {
  let exePath: string

  if (app.isPackaged) {
    exePath = path.join(process.resourcesPath, 'ProteinDesignBackend.exe')
  } else {
    exePath = path.join(__dirname, '..', 'ProteinDesignBackend.exe')
  }

  // Check if exe exists locally
  if (!fs.existsSync(exePath)) {
    log.info('[Server] Backend exe not found, downloading from release...')
    await downloadBackendExe(exePath)
  } else {
    log.info(`[Server] Using local backend exe: ${exePath}`)
  }

  // Start the backend process
  log.info('[Server] Starting Python backend...')
  backendProcess = spawn(exePath, [], {
    cwd: path.dirname(exePath),
    detached: true,
    stdio: 'ignore'
  })

  backendProcess.unref()

  // Wait for server to be ready
  await waitForServerReady()
}

async function downloadBackendExe(destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tempPath = destPath + '.tmp'

    log.info(`[Server] Downloading from ${RELEASE_URL}`)

    const file = fs.createWriteStream(tempPath)
    let downloaded = 0

    https.get(RELEASE_URL, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        // Follow redirect
        const redirectUrl = response.headers.location
        if (redirectUrl) {
          log.info(`[Server] Following redirect to: ${redirectUrl}`)
          https.get(redirectUrl, (redirectResponse) => {
            handleDownload(redirectResponse)
          }).on('error', reject)
          return
        }
      }
      handleDownload(response)
    }).on('error', reject)

    function handleDownload(response: http.IncomingMessage) {
      if (response.statusCode !== 200) {
        reject(new Error(`Download failed with status ${response.statusCode}`))
        return
      }

      const total = parseInt(response.headers['content-length'] || '0', 10)

      response.on('data', (chunk: Buffer) => {
        downloaded += chunk.length
        if (total > 0) {
          const percent = ((downloaded / total) * 100).toFixed(1)
          log.info(`[Server] Download progress: ${percent}%`)
        }
      })

      response.pipe(file)

      file.on('finish', () => {
        file.close()
        fs.renameSync(tempPath, destPath)
        log.info(`[Server] Download complete: ${destPath}`)
        resolve()
      })

      file.on('error', (err) => {
        fs.unlinkSync(tempPath)
        reject(err)
      })
    }
  })
}

async function startMacBackend(): Promise<void> {
  let serverPath: string
  if (app.isPackaged) {
    serverPath = path.join(process.resourcesPath, 'app.asar.unpacked', 'server-napi', 'dist', 'bundle.cjs')
  } else {
    serverPath = path.join(__dirname, '../server-napi/dist/bundle.cjs')
  }

  log.info(`[Server] isPackaged: ${app.isPackaged}`)
  log.info(`[Server] serverPath: ${serverPath}`)

  try {
    const fs = require('fs')
    const exists = fs.existsSync(serverPath)
    log.info(`[Server] bundle exists: ${exists}`)
    if (!exists) {
      throw new Error(`Server bundle not found: ${serverPath}`)
    }
  } catch (err: any) {
    log.error(`[Server] file check error: ${err.message}`)
    throw err
  }

  return new Promise((resolve, reject) => {
    try {
      const resolvedPath = require.resolve(serverPath)
      log.info(`[Server] resolved path: ${resolvedPath}`)
      delete require.cache[resolvedPath]

      log.info('[Server] about to require bundle...')
      require(serverPath)
      log.info('[Server] require completed')

      const startTime = Date.now()
      const checkServer = setInterval(() => {
        const elapsed = Date.now() - startTime
        log.info(`[Server] health check attempt (${elapsed}ms)...`)

        http.get(HEALTH_CHECK_URL, (res) => {
          log.info(`[Server] health check response: ${res.statusCode}`)
          if (res.statusCode === 200) {
            clearInterval(checkServer)
            log.info('[Server] Backend server is ready!')
            resolve()
          } else {
            log.info(`[Server] Server returned status ${res.statusCode}`)
          }
        }).on('error', (err) => {
          const elapsed2 = Date.now() - startTime
          log.info(`[Server] Health check error: ${err.message} (${elapsed2}ms elapsed)`)
          if (elapsed2 > MAX_WAIT_MS) {
            clearInterval(checkServer)
            const error = `Server failed to start within ${MAX_WAIT_MS}ms`
            log.error(`[Server] ${error}`)
            reject(new Error(error))
          }
        })
      }, 2000)

    } catch (error: any) {
      log.error('[Server] Failed to load backend server:', error?.message || error)
      log.error('[Server] Stack:', error?.stack)
      reject(error)
    }
  })
}

async function waitForServerReady(): Promise<void> {
  const startTime = Date.now()

  return new Promise((resolve, reject) => {
    const checkServer = setInterval(() => {
      const elapsed = Date.now() - startTime
      log.info(`[Server] Windows backend health check (${elapsed}ms)...`)

      http.get(HEALTH_CHECK_URL, (res) => {
        log.info(`[Server] health check response: ${res.statusCode}`)
        if (res.statusCode === 200) {
          clearInterval(checkServer)
          log.info('[Server] Windows backend is ready!')
          resolve()
        }
      }).on('error', (err) => {
        const elapsed2 = Date.now() - startTime
        if (elapsed2 > MAX_WAIT_MS) {
          clearInterval(checkServer)
          const error = `Windows backend failed to start within ${MAX_WAIT_MS}ms`
          log.error(`[Server] ${error}`)
          reject(new Error(error))
        }
      })
    }, 3000) // Check every 3 seconds on Windows
  })
}

export async function stopServer(): Promise<void> {
  log.info('[Server] stop called')

  if (backendProcess) {
    log.info('[Server] Killing Windows backend process...')
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', backendProcess.pid!.toString(), '/f', '/t'])
    } else {
      backendProcess.kill()
    }
    backendProcess = null
  }
}
