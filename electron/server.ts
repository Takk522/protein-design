/**
 * Backend server for Protein Design Studio
 * Loads the bundled Express server directly in Electron's main process
 */

import path from 'path'
import { fileURLToPath } from 'url'
import log from 'electron-log'
import http from 'http'
import { app } from 'electron'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export async function startServer(): Promise<void> {
  const isPackaged = app.isPackaged

  let serverPath: string
  if (isPackaged) {
    serverPath = path.join(process.resourcesPath, 'app.asar.unpacked', 'server-napi', 'dist', 'bundle.cjs')
  } else {
    serverPath = path.join(__dirname, '../server-napi/dist/bundle.cjs')
  }

  log.info(`[Server] isPackaged: ${isPackaged}`)
  log.info(`[Server] serverPath: ${serverPath}`)

  // Verify file exists
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
      // Clear require cache
      const resolvedPath = require.resolve(serverPath)
      log.info(`[Server] resolved path: ${resolvedPath}`)
      delete require.cache[resolvedPath]

      // Load the bundled server - it auto-starts when required
      log.info('[Server] about to require bundle...')
      require(serverPath)
      log.info('[Server] require completed')

      // Wait for server to be ready with health checks
      const startTime = Date.now()
      const maxWait = 30000 // 30 seconds

      const checkServer = setInterval(() => {
        const elapsed = Date.now() - startTime
        log.info(`[Server] health check attempt (${elapsed}ms)...`)

        http.get('http://127.0.0.1:8000/health', (res) => {
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
          if (elapsed2 > maxWait) {
            clearInterval(checkServer)
            const error = `Server failed to start within ${maxWait}ms`
            log.error(`[Server] ${error}`)
            reject(new Error(error))
          }
        })
      }, 2000) // Check every 2 seconds

    } catch (error: any) {
      log.error('[Server] Failed to load backend server:', error?.message || error)
      log.error('[Server] Stack:', error?.stack)
      reject(error)
    }
  })
}

export async function stopServer(): Promise<void> {
  log.info('[Server] stop called')
}
