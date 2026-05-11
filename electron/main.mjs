import { app, BrowserWindow, dialog, ipcMain, Menu, Tray, nativeImage } from 'electron'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const allowedExtensions = new Set(['.md', '.markdown', '.mdown'])
const pendingOpenPaths = []
let mainWindow = null
let tray = null

function isMarkdownFile(filePath) {
  return allowedExtensions.has(path.extname(filePath).toLowerCase())
}

async function loadMarkdownFile(filePath) {
  if (!isMarkdownFile(filePath)) {
    return null
  }

  const content = await readFile(filePath, 'utf8')
  return {
    path: filePath,
    name: path.basename(filePath),
    content,
  }
}

async function walkMarkdownFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name)

      if (entry.isDirectory()) {
        return walkMarkdownFiles(entryPath)
      }

      const file = await loadMarkdownFile(entryPath)
      return file ? [file] : []
    }),
  )

  return files.flat().sort((left, right) => left.name.localeCompare(right.name))
}

function createMenuBarImage() {
  const svg = `
    <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
      <path
        fill="black"
        d="M3 4.25C3 3.56 3.56 3 4.25 3h2.17c.49 0 .94.29 1.14.74L9.1 7.21l1.55-3.47A1.25 1.25 0 0 1 11.79 3h1.96C14.44 3 15 3.56 15 4.25v9.5c0 .69-.56 1.25-1.25 1.25a1.25 1.25 0 0 1-1.25-1.25V7.67l-2 4.34c-.21.45-.66.74-1.16.74s-.95-.29-1.16-.74l-1.68-3.63v5.37c0 .69-.56 1.25-1.25 1.25A1.25 1.25 0 0 1 3 13.75v-9.5Zm9.84 10.5c-.63 0-1.16-.5-1.16-1.13 0-.27.1-.54.3-.75l2.28-2.47h-1.47c-.63 0-1.14-.51-1.14-1.14s.51-1.14 1.14-1.14h3.84c.63 0 1.13.5 1.13 1.13 0 .28-.1.55-.28.76l-2.27 2.46h1.58c.63 0 1.14.51 1.14 1.14s-.51 1.14-1.14 1.14h-3.95Z"
      />
    </svg>
  `

  const image = nativeImage.createFromDataURL(
    `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`,
  )
  image.setTemplateImage(true)
  return image.resize({ width: 18, height: 18 })
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore()
  }

  mainWindow.show()
  mainWindow.focus()
}

async function dispatchOpenedFiles(filePaths) {
  const uniquePaths = [...new Set(filePaths.filter((filePath) => isMarkdownFile(filePath)))]
  if (!uniquePaths.length) {
    return
  }

  const files = (await Promise.all(uniquePaths.map(loadMarkdownFile))).filter(Boolean)
  if (!files.length) {
    return
  }

  if (!mainWindow || mainWindow.isDestroyed()) {
    await createWindow()
  }

  showMainWindow()
  mainWindow.webContents.send('mdvw:files-opened', files)
}

async function dispatchLibraryFiles(files) {
  if (!files.length) {
    return
  }

  if (!mainWindow || mainWindow.isDestroyed()) {
    await createWindow()
  }

  showMainWindow()
  mainWindow.webContents.send('mdvw:files-opened', files)
}

function createTray() {
  tray = new Tray(createMenuBarImage())
  tray.setToolTip('md Vw')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: 'Apri md Vw',
        click: () => showMainWindow(),
      },
      {
        label: 'Apri file Markdown',
        click: async () => {
          const file = await pickMarkdownFile()
          if (file) {
            await dispatchOpenedFiles([file.path])
          }
        },
      },
      {
        label: 'Apri cartella',
        click: async () => {
          const folderFiles = await pickMarkdownFolder()
          if (folderFiles.length) {
            await dispatchLibraryFiles(folderFiles)
          }
        },
      },
      { type: 'separator' },
      {
        label: 'Esci',
        click: () => app.quit(),
      },
    ]),
  )
  tray.on('click', () => showMainWindow())
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1040,
    minWidth: 1180,
    minHeight: 760,
    title: 'md Vw',
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#f3ede2',
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  const devServerUrl = process.env.VITE_DEV_SERVER_URL

  if (devServerUrl) {
    await mainWindow.loadURL(devServerUrl)
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    await mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }

  if (pendingOpenPaths.length) {
    const pathsToOpen = pendingOpenPaths.splice(0, pendingOpenPaths.length)
    await dispatchOpenedFiles(pathsToOpen)
  }
}

async function pickMarkdownFile() {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'mdown'] }],
  })

  if (result.canceled || !result.filePaths[0]) {
    return null
  }

  return loadMarkdownFile(result.filePaths[0])
}

async function pickMarkdownFolder() {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
  })

  if (result.canceled || !result.filePaths[0]) {
    return []
  }

  return walkMarkdownFiles(result.filePaths[0])
}

const hasLock = app.requestSingleInstanceLock()

if (!hasLock) {
  app.quit()
} else {
  app.on('second-instance', async (_event, commandLine) => {
    const paths = commandLine.filter((argument) => isMarkdownFile(argument))

    if (paths.length) {
      await dispatchOpenedFiles(paths)
      return
    }

    showMainWindow()
  })
}

app.on('open-file', (event, filePath) => {
  event.preventDefault()

  if (!isMarkdownFile(filePath)) {
    return
  }

  if (!app.isReady()) {
    pendingOpenPaths.push(filePath)
    return
  }

  void dispatchOpenedFiles([filePath])
})

ipcMain.handle('mdvw:open-file', async () => pickMarkdownFile())
ipcMain.handle('mdvw:open-folder', async () => pickMarkdownFolder())

app.whenReady().then(async () => {
  app.setName('md Vw')

  if (process.platform === 'darwin' && app.isPackaged) {
    app.setLoginItemSettings({ openAtLogin: true })
  }

  createTray()
  await createWindow()

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow()
      return
    }

    showMainWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
