import { Worker } from 'node:worker_threads'
import os from 'node:os'
import path from 'node:path'
import workerPath from './storageWorker?modulePath'
import type { StorageProgress, StorageResult } from '../shared/types'

let worker: Worker | null = null
let lastRoot: string | null = null

export function diskRoot(): string {
  if (process.platform === 'win32') return (process.env.SystemDrive || 'C:') + '\\'
  return '/'
}

export function homeRoot(): string {
  return os.homedir()
}

/** Maps a folder on a worker thread. A new scan stops the previous one. */
export function mapFolder(root: string, onProgress: (p: StorageProgress) => void): Promise<StorageResult> {
  cancelMap()
  return new Promise<StorageResult>((resolve, reject) => {
    const file = workerPath.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1')
    const w = new Worker(file, { workerData: { root } })
    worker = w
    w.on('message', (m: { type: string; progress?: StorageProgress; result?: StorageResult; message?: string }) => {
      if (m.type === 'progress') onProgress(m.progress!)
      else if (m.type === 'done') {
        lastRoot = m.result!.root
        resolve(m.result!)
      } else reject(new Error(m.message))
    })
    w.on('error', reject)
    w.on('exit', (code) => {
      if (worker === w) worker = null
      if (code !== 0) reject(new Error('Scan stopped'))
    })
  })
}

export function cancelMap(): void {
  worker?.terminate()
  worker = null
}

/** Only paths inside the last scanned folder may be revealed. */
export function revealable(p: string): string | null {
  if (!lastRoot) return null
  const full = path.resolve(p)
  const rel = path.relative(lastRoot, full)
  return rel.startsWith('..') || path.isAbsolute(rel) ? null : full
}
