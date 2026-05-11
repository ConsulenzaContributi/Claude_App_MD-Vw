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
    <svg width="24" height="18" viewBox="0 0 24 18" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M2.4 13.8V4.2h1.8l2.5 4.4 2.5-4.4h1.8v9.6H9.3V7.7L7.1 11.5H6.2L4 7.7v6.1H2.4Z"
        fill="black"
      />
      <path
        d="M13.2 13.8V4.2h3.2c3.2 0 5.2 1.8 5.2 4.8s-2 4.8-5.2 4.8h-3.2Zm1.9-1.6h1.2c2.1 0 3.4-1.2 3.4-3.2s-1.3-3.2-3.4-3.2h-1.2v6.4Z"
        fill="black"
      />
    </svg>
  `

  const image = nativeImage.createFromDataURL(
    `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`,
  )
  image.setTemplateImage(true)
  return image.resize({ width: 24, height: 18 })
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
  const trayImage =
    process.platform === 'darwin'
      ? nativeImage.createEmpty()
      : createMenuBarImage()

  tray = new Tray(trayImage)
  tray.setToolTip('md Vw')
  if (process.platform === 'darwin') {
    tray.setTitle('MD')
  }
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
