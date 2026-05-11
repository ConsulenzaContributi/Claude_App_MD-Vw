import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('mdVw', {
  openMarkdownFile: () => ipcRenderer.invoke('mdvw:open-file'),
  openMarkdownFolder: () => ipcRenderer.invoke('mdvw:open-folder'),
  onFilesOpened: (listener) => {
    const wrapped = (_event, files) => listener(files)
    ipcRenderer.on('mdvw:files-opened', wrapped)
    return () => ipcRenderer.removeListener('mdvw:files-opened', wrapped)
  },
})
