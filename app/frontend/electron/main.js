import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron'
import { spawn } from 'child_process'
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import fs from 'fs'
import crypto from 'crypto'
import https from 'https'
import http from 'http'
import * as XLSX from 'xlsx'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const isDev = !app.isPackaged

let mainWindow
let backendProcess
let frontendProcess
let backendServer
let localBackendEnabled = false
let staticServer
let staticServerPort

const requestLocalApiJson = (method, urlPath, body = null, timeoutMs = 8000) => new Promise((resolve, reject) => {
  try {
    const data = body == null ? null : Buffer.from(JSON.stringify(body), 'utf8')
    const req = http.request({
      hostname: '127.0.0.1',
      port: Number(process.env.PORT || 3005),
      path: urlPath,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': data.length } : {})
      },
      timeout: timeoutMs
    }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        try {
          resolve(JSON.parse(text || '{}'))
        } catch (_) {
          resolve({ statusCode: res.statusCode || 0, raw: text })
        }
      })
    })
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', (err) => reject(err))
    if (data) req.write(data)
    req.end()
  } catch (e) {
    reject(e)
  }
})

const triggerExitCloudSync = async () => {
  if (!localBackendEnabled) return
  try {
    const cfgResp = await requestLocalApiJson('GET', '/api/system/cloud-sync/config', null, 3000)
    const cfg = cfgResp && typeof cfgResp === 'object' ? (cfgResp.data || cfgResp) : {}
    if (!cfg.exitSync) return
    await requestLocalApiJson('POST', '/api/system/cloud-sync/run', { mode: 'incremental' }, 8000)
  } catch (_) {
    void 0
  }
}

function parseEnvBool(value) {
  if (value == null) return null
  const normalized = String(value).trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  return null
}

function shouldStartLocalBackend() {
  const disabled = parseEnvBool(process.env.ELECTRON_DISABLE_LOCAL_BACKEND)
  if (disabled === true) return false

  const enabled = parseEnvBool(process.env.ELECTRON_START_LOCAL_BACKEND)
  if (enabled != null) return enabled
  return !isDev
}

function shouldOfflineMode() {
  const v = parseEnvBool(process.env.ELECTRON_OFFLINE_MODE)
  if (v != null) return v
  return !isDev
}

function appendMainLog(message) {
  try {
    const logDir = app.getPath('userData')
    const logFile = path.join(logDir, 'main.log')
    const line = `[${new Date().toISOString()}] ${String(message)}\n`
    fs.appendFileSync(logFile, line, { encoding: 'utf8' })
  } catch (_) {
    void 0
  }
}

function resolveContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.html') return 'text/html; charset=utf-8'
  if (ext === '.js') return 'text/javascript; charset=utf-8'
  if (ext === '.css') return 'text/css; charset=utf-8'
  if (ext === '.json') return 'application/json; charset=utf-8'
  if (ext === '.svg') return 'image/svg+xml'
  if (ext === '.png') return 'image/png'
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.ico') return 'image/x-icon'
  if (ext === '.map') return 'application/json; charset=utf-8'
  return 'application/octet-stream'
}

async function startStaticServer() {
  if (staticServer) return
  const rootDir = path.join(__dirname, '../web-dist')

  staticServer = http.createServer((req, res) => {
    try {
      const reqUrl = new URL(req.url || '/', 'http://127.0.0.1')
      const pathname = decodeURIComponent(reqUrl.pathname || '/')
      const safePath = path.normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, '')
      const candidate = path.join(rootDir, safePath)

      const sendFile = (filePath) => {
        fs.readFile(filePath, (err, buf) => {
          if (err) {
            res.statusCode = 404
            res.setHeader('Content-Type', 'text/plain; charset=utf-8')
            res.end('Not Found')
            return
          }
          res.statusCode = 200
          res.setHeader('Content-Type', resolveContentType(filePath))
          res.end(buf)
        })
      }

      fs.stat(candidate, (err, stat) => {
        if (!err && stat && stat.isDirectory()) {
          sendFile(path.join(candidate, 'index.html'))
          return
        }
        if (!err && stat) {
          sendFile(candidate)
          return
        }
        sendFile(path.join(rootDir, 'index.html'))
      })
    } catch (e) {
      res.statusCode = 500
      res.setHeader('Content-Type', 'text/plain; charset=utf-8')
      res.end('Internal Server Error')
      appendMainLog(`static server error: ${String(e && e.stack ? e.stack : e)}`)
    }
  })

  const basePort = Number(process.env.ELECTRON_STATIC_PORT || 0) || 27133
  const host = '127.0.0.1'
  const tryListen = (port) => new Promise((resolve, reject) => {
    const onError = (err) => {
      staticServer.off('listening', onListening)
      reject(err)
    }
    const onListening = () => {
      staticServer.off('error', onError)
      const addr = staticServer.address()
      staticServerPort = addr && typeof addr === 'object' ? addr.port : null
      resolve()
    }
    staticServer.once('error', onError)
    staticServer.once('listening', onListening)
    staticServer.listen(port, host)
  })

  let lastError = null
  for (let i = 0; i < 20; i += 1) {
    const port = basePort + i
    try {
      await tryListen(port)
      appendMainLog(`static server listen ${host}:${String(staticServerPort)}`)
      return
    } catch (e) {
      lastError = e
      if (String(e?.code || '') !== 'EADDRINUSE') break
    }
  }
  try {
    staticServerPort = null
    await tryListen(0)
    appendMainLog(`static server fallback listen ${host}:${String(staticServerPort)}`)
  } catch (e) {
    appendMainLog(`static server start failed: ${String(e && e.stack ? e.stack : e)}`)
    if (lastError) throw lastError
    throw e
  }
}

// 启动后端服务
async function startBackendServer() {
  localBackendEnabled = shouldStartLocalBackend()
  if (!localBackendEnabled) {
    appendMainLog('local backend disabled')
    return
  }
  if (isDev) {
    const backendPath = path.join(__dirname, '../../backend/src/app.js')
    backendProcess = spawn('node', [backendPath], {
      env: {
        ...process.env,
        NODE_ENV: 'development',
        PORT: 3005
      }
    })

    backendProcess.stdout.on('data', (data) => {
      console.log(`后端输出: ${data}`)
      appendMainLog(`backend stdout: ${String(data)}`)
    })

    backendProcess.stderr.on('data', (data) => {
      console.error(`后端错误: ${data}`)
      appendMainLog(`backend stderr: ${String(data)}`)
    })

    backendProcess.on('close', (code) => {
      console.log(`后端进程退出，退出码 ${code}`)
      appendMainLog(`backend exit: ${String(code)}`)
    })

    return
  }

  try {
    process.env.DESKTOP_APP = 'true'
    process.env.NODE_ENV = 'production'
    process.env.PORT = process.env.PORT || '3005'
    if (shouldOfflineMode()) {
      process.env.OFFLINE_MODE = 'true'
      process.env.ENABLE_CLOUD_SYNC = 'false'
    }
    process.env.LOG_DIR = process.env.LOG_DIR || path.join(app.getPath('userData'), 'logs')
    const secretPath = path.join(app.getPath('userData'), 'jwt.secret')
    let secret = ''
    try {
      secret = String(fs.readFileSync(secretPath, 'utf8') || '').trim()
    } catch (_) {
      secret = ''
    }
    if (!secret) {
      secret = crypto.randomBytes(48).toString('base64url')
      try {
        fs.writeFileSync(secretPath, `${secret}\n`, { encoding: 'utf8' })
      } catch (e) {
        appendMainLog(`jwt secret write failed: ${String(e && e.stack ? e.stack : e)}`)
      }
    }
    if (secret) process.env.JWT_SECRET = secret
    const backendPath = path.join(process.resourcesPath, 'backend/src/app.js')
    const backendModule = await import(pathToFileURL(backendPath).href)
    if (backendModule && typeof backendModule.startServer === 'function') {
      backendServer = await backendModule.startServer(Number(process.env.PORT) || 3005)
      console.log('本地后端服务已启动')
      appendMainLog('backend started')
    } else {
      throw new Error('未找到后端 startServer 方法')
    }
  } catch (error) {
    console.error('启动本地后端服务失败:', error)
    appendMainLog(`backend start failed: ${String(error && error.stack ? error.stack : error)}`)
    localBackendEnabled = false
    try {
      dialog.showErrorBox('后端启动失败', String(error && error.message ? error.message : error))
    } catch (_) {
      void 0
    }
  }
}

// 启动前端开发服务器
function startFrontendServer() {
  return new Promise((resolve) => {
    frontendProcess = spawn('npm', ['run', 'dev'], {
      cwd: path.join(__dirname, '../'),
      shell: true,
      stdio: 'pipe'
    })

    frontendProcess.stdout.on('data', (data) => {
      const output = data.toString()
      console.log(`前端输出: ${output}`)
      
      // 检测前端服务器启动完成
      if (output.includes('Local:') || output.includes('http://localhost:3001')) {
        console.log('前端服务器启动完成')
        setTimeout(resolve, 2000) // 等待2秒确保服务器完全启动
      }
    })

    frontendProcess.stderr.on('data', (data) => {
      console.error(`前端错误: ${data}`)
    })
  })
}

function createWindow() {
  // 创建浏览器窗口
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs')
    },
    icon: path.join(__dirname, 'assets/icon.ico'),
    title: 'ERP管理系统',
    show: false
  })

  mainWindow.webContents.on('did-fail-load', (_, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame) return
    const detail = `code=${errorCode}\ndesc=${errorDescription}\nurl=${validatedURL}`
    appendMainLog(`did-fail-load: ${detail}`)
    try {
      dialog.showErrorBox('页面加载失败', detail)
    } catch (_) {
      void 0
    }
    try {
      mainWindow.show()
      if (String(process.env.ELECTRON_OPEN_DEVTOOLS).toLowerCase() === 'true') {
        mainWindow.webContents.openDevTools()
      }
    } catch (_) {
      void 0
    }
  })

  mainWindow.webContents.on('render-process-gone', (_, details) => {
    const detail = JSON.stringify(details || {})
    appendMainLog(`render-process-gone: ${detail}`)
    try {
      dialog.showErrorBox('渲染进程异常退出', detail)
    } catch (_) {
      void 0
    }
  })

  mainWindow.webContents.on('console-message', (_, level, message, line, sourceId) => {
    appendMainLog(`renderer console: level=${level} ${sourceId}:${line} ${message}`)
  })

  // 加载应用 - 开发模式下使用前端开发服务器
  if (isDev) {
    void mainWindow.loadURL('http://localhost:3002').catch((e) => {
      appendMainLog(`loadURL dev failed: ${String(e && e.stack ? e.stack : e)}`)
    })
  } else {
    const port = Number(staticServerPort)
    const url = Number.isFinite(port) && port > 0 ? `http://127.0.0.1:${port}` : ''
    if (url) {
      void mainWindow.loadURL(url).catch((e) => {
        appendMainLog(`loadURL prod failed: ${String(e && e.stack ? e.stack : e)}`)
        try {
          dialog.showErrorBox('页面加载失败', String(e && e.message ? e.message : e))
        } catch (_) {
          void 0
        }
      })
    } else {
      const indexPath = path.join(__dirname, '../web-dist/index.html')
      void mainWindow.loadFile(indexPath).catch((e) => {
        appendMainLog(`loadFile failed: ${String(e && e.stack ? e.stack : e)}`)
        try {
          dialog.showErrorBox('页面加载失败', String(e && e.message ? e.message : e))
        } catch (_) {
          void 0
        }
      })
    }
  }

  // 窗口准备好后显示
  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
    
    // 开发模式下打开开发者工具
    if (isDev) {
      mainWindow.webContents.openDevTools()
    } else if (String(process.env.ELECTRON_OPEN_DEVTOOLS).toLowerCase() === 'true') {
      mainWindow.webContents.openDevTools()
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
    
    // 关闭后端进程
    if (backendProcess) {
      backendProcess.kill()
    }
    if (backendServer && typeof backendServer.close === 'function') {
      try {
        backendServer.close()
      } catch (_) {
        void 0
      }
    }
    if (staticServer && typeof staticServer.close === 'function') {
      try {
        staticServer.close()
      } catch (_) {
        void 0
      } finally {
        staticServer = null
        staticServerPort = null
      }
    }
  })
}

// 应用准备就绪
app.whenReady().then(async () => {
  // 启动后端服务
  await startBackendServer()

  if (!isDev) {
    try {
      await startStaticServer()
      appendMainLog(`static server started on port ${String(staticServerPort || '')}`)
    } catch (e) {
      appendMainLog(`static server start failed: ${String(e && e.stack ? e.stack : e)}`)
    }
  }
  
  // 开发模式下启动前端服务器并等待其启动完成（可通过环境变量跳过）
  if (isDev) {
    if (String(process.env.ELECTRON_SKIP_FRONTEND).toLowerCase() !== 'true') {
      console.log('正在启动前端开发服务器...')
      await startFrontendServer()
      console.log('前端服务器启动完成，准备加载应用...')
    } else {
      console.log('跳过前端开发服务器启动（ELECTRON_SKIP_FRONTEND=true）')
    }
  }
  
  // 创建窗口
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

let _quitGuard = false
app.on('before-quit', (event) => {
  if (_quitGuard) return
  _quitGuard = true
  event.preventDefault()
  triggerExitCloudSync().finally(() => {
    app.quit()
  })
})

// 所有窗口关闭时退出应用（macOS除外）
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// 安全设置
app.on('web-contents-created', (event, contents) => {
  contents.on('new-window', (event, navigationUrl) => {
    event.preventDefault()
  })
})

// 处理来自渲染进程的消息
ipcMain.handle('get-backend-status', () => {
  if (!localBackendEnabled) return 'disabled'
  return backendProcess || backendServer ? 'running' : 'stopped'
})

ipcMain.handle('window-minimize', () => {
  const win = BrowserWindow.getFocusedWindow()
  if (win) win.minimize()
  return true
})

ipcMain.handle('window-maximize', () => {
  const win = BrowserWindow.getFocusedWindow()
  if (!win) return false
  if (win.isMaximized()) {
    win.unmaximize()
  } else {
    win.maximize()
  }
  return true
})

ipcMain.handle('window-close', () => {
  const win = BrowserWindow.getFocusedWindow()
  if (win) win.close()
  return true
})

ipcMain.handle('select-directory', async () => {
  const win = BrowserWindow.getFocusedWindow()
  const result = await dialog.showOpenDialog(win || undefined, {
    properties: ['openDirectory', 'createDirectory']
  })
  if (result.canceled) return null
  const filePaths = Array.isArray(result.filePaths) ? result.filePaths : []
  return filePaths.length ? filePaths[0] : null
})

ipcMain.handle('app-relaunch', () => {
  try {
    app.relaunch()
    app.exit(0)
    return true
  } catch (_) {
    return false
  }
})

ipcMain.handle('download-and-save', async (_, payload = {}) => {
  const url = String(payload.url || '').trim()
  const directory = String(payload.directory || '').trim()
  const filename = String(payload.filename || '').trim()
  if (!url || !directory || !filename) {
    throw new Error('缺少下载参数')
  }

  await fs.promises.mkdir(directory, { recursive: true })
  const targetPath = path.join(directory, filename)

  const downloadToFile = async (downloadUrl, depth = 0) => {
    if (depth > 5) {
      throw new Error('下载重定向次数过多')
    }
    const requestImpl = String(downloadUrl).startsWith('https://') ? https : http
    await new Promise((resolve, reject) => {
      const req = requestImpl.get(downloadUrl, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const redirectUrl = new URL(String(res.headers.location), String(downloadUrl)).toString()
          res.resume()
          Promise.resolve()
            .then(() => downloadToFile(redirectUrl, depth + 1))
            .then(resolve)
            .catch(reject)
          return
        }
        if (res.statusCode !== 200) {
          res.resume()
          reject(new Error(`下载失败: HTTP ${res.statusCode || 'unknown'}`))
          return
        }
        const fileStream = fs.createWriteStream(targetPath)
        res.pipe(fileStream)
        fileStream.on('finish', () => {
          fileStream.close(() => resolve())
        })
        fileStream.on('error', (err) => {
          try { fileStream.close() } catch (_) {}
          reject(err)
        })
      })
      req.on('error', reject)
    })
  }

  await downloadToFile(url, 0)

  return { savedPath: targetPath }
})

ipcMain.handle('rasp-report', async (_, payload = {}) => {
  const nowIso = new Date().toISOString()
  const data = payload && typeof payload === 'object' ? payload : { message: String(payload || '') }
  const safe = {
    ts: nowIso,
    type: String(data.type || 'unknown'),
    status: Number.isFinite(Number(data.status)) ? Number(data.status) : undefined,
    code: data.code != null ? String(data.code) : undefined,
    message: data.message != null ? String(data.message) : undefined,
    url: data.url != null ? String(data.url) : undefined,
    method: data.method != null ? String(data.method) : undefined,
    deviceId: data.deviceId != null ? String(data.deviceId) : undefined,
    userId: data.userId != null ? String(data.userId) : undefined,
    stack: data.stack != null ? String(data.stack) : undefined,
    extra: data.extra && typeof data.extra === 'object' ? data.extra : undefined
  }

  try {
    const logDir = app.getPath('userData')
    const logFile = path.join(logDir, 'rasp.log')
    fs.appendFileSync(logFile, `${JSON.stringify(safe)}\n`, { encoding: 'utf8' })
  } catch (e) {
    appendMainLog(`rasp log write failed: ${String(e && e.stack ? e.stack : e)}`)
  }

  const endpoint = String(process.env.RASP_ENDPOINT || '').trim()
  if (endpoint) {
    try {
      const u = new URL(endpoint)
      const isHttps = u.protocol === 'https:'
      const body = Buffer.from(JSON.stringify(safe), 'utf8')
      const opts = {
        method: 'POST',
        hostname: u.hostname,
        port: u.port ? Number(u.port) : (isHttps ? 443 : 80),
        path: `${u.pathname || '/'}${u.search || ''}`,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': body.length
        }
      }
      await new Promise((resolve, reject) => {
        const req = (isHttps ? https : http).request(opts, (res) => {
          res.resume()
          resolve()
        })
        req.on('error', reject)
        req.write(body)
        req.end()
      })
    } catch (e) {
      appendMainLog(`rasp report failed: ${String(e && e.stack ? e.stack : e)}`)
    }
  }

  return true
})

ipcMain.handle('generate-quote-xlsx', async (_, payload = {}) => {
  const safeText = (v) => String(v == null ? '' : v).trim()
  const customerName = safeText(payload.customerName) || '客户'
  const templatePath = safeText(payload.templatePath) || ''
  const targetPath = safeText(payload.targetPath) || ''
  const rows = Array.isArray(payload.rows) ? payload.rows : []

  const normalizeFilename = (name) => String(name || '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
  const defaultFilename = normalizeFilename(`${customerName}报价单.xlsx`) || '报价单.xlsx'

  let workbook = null
  if (templatePath) {
    try {
      await fs.promises.access(templatePath, fs.constants.R_OK)
      workbook = XLSX.readFile(templatePath, { cellStyles: true })
    } catch (_) {
      workbook = null
    }
  }

  if (!workbook) {
    workbook = XLSX.utils.book_new()
    const header = [['系列号', '料号', '名称', '规格', '价格', '备注']]
    const ws = XLSX.utils.aoa_to_sheet(header)
    XLSX.utils.book_append_sheet(workbook, ws, 'Sheet1')
  }

  const sheetName = workbook.SheetNames && workbook.SheetNames.length ? workbook.SheetNames[0] : 'Sheet1'
  const ws = workbook.Sheets[sheetName] || XLSX.utils.aoa_to_sheet([['系列号', '料号', '名称', '规格', '价格', '备注']])
  workbook.Sheets[sheetName] = ws

  const normalizeRows = (rows || [])
    .filter((r) => Array.isArray(r) && r.length)
    .map((r) => r.map((v) => (v == null ? '' : v)))

  const setCell = (address, value, baseCell) => {
    const next = {}
    if (typeof value === 'number' && Number.isFinite(value)) {
      next.t = 'n'
      next.v = value
    } else if (typeof value === 'boolean') {
      next.t = 'b'
      next.v = value
    } else {
      next.t = 's'
      next.v = String(value == null ? '' : value)
    }
    if (baseCell && baseCell.s) next.s = baseCell.s
    if (baseCell && baseCell.z) next.z = baseCell.z
    ws[address] = next
  }

  const parseRows = () => XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) || []
  const findHeaderRowIndex = (aoa) => {
    const has = (row, keyword) => (row || []).some((c) => String(c || '').trim() === keyword)
    for (let i = 0; i < Math.min(30, aoa.length); i += 1) {
      const row = Array.isArray(aoa[i]) ? aoa[i] : []
      if (has(row, '料号') && has(row, '名称')) return i
      if (has(row, '物料号') && (has(row, '名称') || has(row, '品名'))) return i
      if (has(row, '名称') && has(row, '规格')) return i
    }
    return 0
  }

  const shiftSheetRows = (startRow, delta) => {
    if (!delta) return
    const keys = Object.keys(ws).filter((k) => k && k[0] !== '!')
    const moving = []
    keys.forEach((addr) => {
      const decoded = XLSX.utils.decode_cell(addr)
      if (decoded.r >= startRow) moving.push({ addr, r: decoded.r, c: decoded.c })
    })
    moving.sort((a, b) => {
      if (delta > 0) return (b.r - a.r) || (b.c - a.c)
      return (a.r - b.r) || (a.c - b.c)
    })
    moving.forEach(({ addr, r, c }) => {
      const nextAddr = XLSX.utils.encode_cell({ r: r + delta, c })
      ws[nextAddr] = ws[addr]
      delete ws[addr]
    })
    const merges = Array.isArray(ws['!merges']) ? ws['!merges'] : []
    if (merges.length) {
      ws['!merges'] = merges.map((m) => {
        const next = {
          s: { r: m.s.r, c: m.s.c },
          e: { r: m.e.r, c: m.e.c }
        }
        if (m.s.r >= startRow) next.s.r += delta
        if (m.e.r >= startRow) next.e.r += delta
        if (m.s.r < startRow && m.e.r >= startRow) next.e.r += delta
        return next
      })
    }
  }

  const applyCustomerName = (name) => {
    const n = safeText(name)
    if (!n) return
    const keys = Object.keys(ws).filter((k) => k && k[0] !== '!')
    let updated = false
    for (const addr of keys) {
      const cell = ws[addr]
      const v = cell && typeof cell.v === 'string' ? cell.v : null
      if (!v) continue
      const decoded = XLSX.utils.decode_cell(addr)
      if (decoded.r > 50 || decoded.c > 20) continue
      if (v.includes('{{customerName}}') || v.includes('{{客户名称}}') || v.includes('{customerName}') || v.includes('{客户名称}')) {
        cell.v = v
          .replaceAll('{{customerName}}', n)
          .replaceAll('{{客户名称}}', n)
          .replaceAll('{customerName}', n)
          .replaceAll('{客户名称}', n)
        updated = true
        continue
      }
      const t = v.replace(/\s+/g, '')
      if (t === '客户名称' || t === '客户') {
        const rightAddr = XLSX.utils.encode_cell({ r: decoded.r, c: decoded.c + 1 })
        setCell(rightAddr, n, ws[rightAddr] || cell)
        updated = true
      } else if (t.startsWith('客户名称：') || t.startsWith('客户名称:') || t.startsWith('客户：') || t.startsWith('客户:')) {
        const sep = v.includes('：') ? '：' : ':'
        const prefix = v.split(sep)[0]
        cell.v = `${prefix}${sep}${n}`
        updated = true
      }
    }
    if (!updated) {
      const a1 = ws.A1
      const a1Text = a1 && typeof a1.v === 'string' ? a1.v.trim() : ''
      if (!a1Text) setCell('A1', `客户：${n}`, a1)
    }
  }

  const aoa = parseRows()
  const headerRowIndex = findHeaderRowIndex(aoa)
  const insertAtRow = Math.max(0, headerRowIndex + 1)

  const baseCellsByCol = new Map()
  if (normalizeRows.length) {
    for (let c = 0; c < normalizeRows[0].length; c += 1) {
      const addr = XLSX.utils.encode_cell({ r: insertAtRow, c })
      if (ws[addr]) baseCellsByCol.set(c, ws[addr])
    }
  }

  if (normalizeRows.length) {
    const rowEmpty = (row) => {
      if (!Array.isArray(row) || !row.length) return true
      for (let i = 0; i < 6; i += 1) {
        if (String(row[i] == null ? '' : row[i]).trim()) return false
      }
      return true
    }
    let existingDataLen = 0
    for (let i = insertAtRow; i < aoa.length; i += 1) {
      if (rowEmpty(aoa[i])) break
      existingDataLen += 1
    }

    const clearRows = (start, count) => {
      if (!count) return
      const end = start + count - 1
      const keys = Object.keys(ws).filter((k) => k && k[0] !== '!')
      keys.forEach((addr) => {
        const decoded = XLSX.utils.decode_cell(addr)
        if (decoded.r >= start && decoded.r <= end) delete ws[addr]
      })
    }

    const delta = normalizeRows.length - existingDataLen
    if (delta) shiftSheetRows(insertAtRow + existingDataLen, delta)
    clearRows(insertAtRow, Math.max(existingDataLen, normalizeRows.length))
    normalizeRows.forEach((row, rIndex) => {
      row.forEach((value, cIndex) => {
        const addr = XLSX.utils.encode_cell({ r: insertAtRow + rIndex, c: cIndex })
        setCell(addr, value, baseCellsByCol.get(cIndex))
      })
    })
    const maxCol = normalizeRows.reduce((m, r) => Math.max(m, Array.isArray(r) ? r.length : 0), 0) - 1
    const currentRange = XLSX.utils.decode_range(ws['!ref'] || 'A1:A1')
    currentRange.e.r = Math.max(currentRange.e.r, insertAtRow + normalizeRows.length)
    if (maxCol >= 0) currentRange.e.c = Math.max(currentRange.e.c, maxCol)
    ws['!ref'] = XLSX.utils.encode_range(currentRange)
  }

  applyCustomerName(customerName)

  if (targetPath) {
    XLSX.writeFile(workbook, targetPath, { cellStyles: true })
    return { savedPath: targetPath }
  }

  const win = BrowserWindow.getFocusedWindow()
  const result = await dialog.showSaveDialog(win || undefined, {
    defaultPath: path.join(app.getPath('downloads'), defaultFilename),
    filters: [{ name: 'Excel', extensions: ['xlsx'] }]
  })
  if (result.canceled || !result.filePath) return null

  XLSX.writeFile(workbook, result.filePath, { cellStyles: true })
  return { savedPath: result.filePath }
})

ipcMain.handle('show-item-in-folder', async (_, targetPath) => {
  const p = String(targetPath || '').trim()
  if (!p) return false
  await shell.showItemInFolder(p)
  return true
})
