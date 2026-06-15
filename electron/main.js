const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const path = require('node:path')
const fs = require('node:fs')

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged
const dataDir = path.join(app.getPath('userData'), 'data')
const dataFile = path.join(dataDir, 'lab-sample-data.json')

function ensureDataDir() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true })
  }
}

const defaultData = {
  users: [
    { id: 'user-1', username: '操作员小王', role: 'operator' },
    { id: 'user-2', username: '复核员老李', role: 'reviewer' },
  ],
  batches: [],
  samples: [],
  importResults: [],
  batchLedger: [],
  currentUserId: 'user-1',
}

function mergeWithDefaults(data) {
  return {
    ...defaultData,
    ...data,
    importResults: data.importResults || [],
    batchLedger: data.batchLedger || [],
    samples: (data.samples || []).map((s) => ({
      ...s,
      history: s.history || [],
    })),
  }
}

function loadData() {
  ensureDataDir()
  if (!fs.existsSync(dataFile)) {
    fs.writeFileSync(dataFile, JSON.stringify(defaultData, null, 2), 'utf-8')
    return defaultData
  }
  const raw = fs.readFileSync(dataFile, 'utf-8')
  const data = JSON.parse(raw)
  return mergeWithDefaults(data)
}

function saveData(data) {
  ensureDataDir()
  fs.writeFileSync(dataFile, JSON.stringify(data, null, 2), 'utf-8')
}

let mainWindow = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: '实验室样本流转登记工具',
  })

  if (isDev) {
    const port = process.env.VITE_PORT || '5173'
    mainWindow.loadURL(`http://localhost:${port}`)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

ipcMain.handle('getData', () => {
  return loadData()
})

ipcMain.handle('saveData', (_event, data) => {
  saveData(data)
  return true
})

ipcMain.handle('exportCSV', (_event, content, defaultName) => {
  const result = dialog.showSaveDialogSync(mainWindow, {
    title: '导出交接清单',
    defaultPath: defaultName,
    filters: [{ name: 'CSV 文件', extensions: ['csv'] }],
  })
  if (result) {
    fs.writeFileSync(result, '\uFEFF' + content, 'utf-8')
    return true
  }
  return false
})
