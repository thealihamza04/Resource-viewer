import { contextBridge, ipcRenderer } from 'electron'
import type { Api, ScanProgress, StorageProgress } from '../shared/types'

const api: Api = {
  win: {
    platform: process.platform,
    minimize: () => ipcRenderer.invoke('win:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('win:toggle-maximize'),
    close: () => ipcRenderer.invoke('win:close'),
    isMaximized: () => ipcRenderer.invoke('win:is-maximized'),
    onMaximizedChange: (cb) => {
      const listener = (_e: Electron.IpcRendererEvent, m: boolean) => cb(m)
      ipcRenderer.on('win:maximized', listener)
      return () => ipcRenderer.removeListener('win:maximized', listener)
    }
  },
  getStatic: () => ipcRenderer.invoke('sys:static'),
  getSnapshot: () => ipcRenderer.invoke('sys:snapshot'),
  getDisks: () => ipcRenderer.invoke('sys:disks'),
  getProcesses: () => ipcRenderer.invoke('sys:processes'),
  killProcess: (pid, force) => ipcRenderer.invoke('sys:kill', pid, force === true),
  scan: () => ipcRenderer.invoke('clean:scan'),
  clean: (ids) => ipcRenderer.invoke('clean:run', ids),
  openTarget: (id) => ipcRenderer.invoke('clean:open', id),
  onScanProgress: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, p: ScanProgress) => cb(p)
    ipcRenderer.on('clean:progress', listener)
    return () => ipcRenderer.removeListener('clean:progress', listener)
  },
  storage: {
    scan: (scope) => ipcRenderer.invoke('storage:scan', scope),
    cancel: () => ipcRenderer.invoke('storage:cancel'),
    reveal: (p) => ipcRenderer.invoke('storage:reveal', p),
    onProgress: (cb) => {
      const listener = (_e: Electron.IpcRendererEvent, p: StorageProgress) => cb(p)
      ipcRenderer.on('storage:progress', listener)
      return () => ipcRenderer.removeListener('storage:progress', listener)
    }
  }
}

contextBridge.exposeInMainWorld('api', api)
