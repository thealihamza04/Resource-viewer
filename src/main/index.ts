import { app, BrowserWindow, ipcMain, nativeTheme, shell } from 'electron'
import path from 'node:path'
import { targetFolder } from './cleaner'
import { runJob } from './jobs'
import icon from '../../resources/icon.png?asset'
import { getDisks, getProcesses, getSnapshot, getStatic, killProcess } from './metrics'

function createWindow() {
  const win = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 900,
    minHeight: 620,
    show: false,
    title: 'Resource Viewer',
    autoHideMenuBar: true,
    // Custom title bar: the app header draws it. macOS keeps its traffic lights.
    frame: process.platform === 'darwin',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : undefined,
    // Window/taskbar icon on Linux (Windows uses the .exe icon, macOS the .icns).
    ...(process.platform === 'linux' ? { icon } : {}),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#09090b' : '#fafafa',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // RV_HIDDEN=1 renders off-screen (no visible window) for automated screenshot checks.
      offscreen: !!process.env.RV_HIDDEN
    }
  })
  if (!process.env.RV_HIDDEN) win.once('ready-to-show', () => win.show())

  const sendMaximized = () => win.webContents.send('win:maximized', win.isMaximized())
  win.on('maximize', sendMaximized)
  win.on('unmaximize', sendMaximized)

  // Open external links in the browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(path.join(__dirname, '../renderer/index.html'))
}

function registerIpc() {
  const sender = (e: Electron.IpcMainInvokeEvent) => BrowserWindow.fromWebContents(e.sender)
  ipcMain.handle('win:minimize', (e) => sender(e)?.minimize())
  ipcMain.handle('win:toggle-maximize', (e) => {
    const w = sender(e)
    if (w) w.isMaximized() ? w.unmaximize() : w.maximize()
  })
  ipcMain.handle('win:close', (e) => sender(e)?.close())
  ipcMain.handle('win:is-maximized', (e) => sender(e)?.isMaximized() ?? false)
  ipcMain.handle('sys:static', () => getStatic())
  ipcMain.handle('sys:snapshot', () => getSnapshot())
  ipcMain.handle('sys:disks', () => getDisks())
  ipcMain.handle('sys:processes', () => getProcesses())
  ipcMain.handle('sys:kill', (_e, pid: unknown, force: unknown) => killProcess(Number(pid), force === true))
  ipcMain.handle('clean:scan', (e) => runJob({ kind: 'scan' }, (p) => e.sender.send('clean:progress', p)))
  ipcMain.handle('clean:run', (e, ids: unknown) => {
    const list = Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : []
    return runJob({ kind: 'clean', ids: list }, (p) => e.sender.send('clean:progress', p))
  })
  ipcMain.handle('clean:open', async (_e, id: unknown) => {
    const dir = typeof id === 'string' ? targetFolder(id) : undefined
    if (dir) await shell.openPath(dir)
  })
}

// Windows: group taskbar entries and show the right icon for this app.
if (process.platform === 'win32') app.setAppUserModelId('com.resourceviewer.app')

app.whenReady().then(() => {
  registerIpc()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
