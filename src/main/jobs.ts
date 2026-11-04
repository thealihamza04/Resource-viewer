import { Worker } from 'node:worker_threads'
import workerPath from './cleanWorker?modulePath'
import type { Job, WorkerMessage } from './cleanWorker'
import type { ScanProgress } from '../shared/types'

let running: { kind: Job['kind']; promise: Promise<unknown> } | null = null

/**
 * Runs a scan/clean job off the main thread. Only one job runs at a time; a scan
 * requested while another scan is running (e.g. after a window reload) joins it.
 */
export function runJob<T>(job: Job, onProgress: (p: ScanProgress) => void): Promise<T> {
  if (running?.kind === 'scan' && job.kind === 'scan') return running.promise as Promise<T>
  if (running) return Promise.reject(new Error('A clean is still running. Please wait for it to finish.'))
  const p = new Promise<T>((resolve, reject) => {
    // In the packaged app the worker is unpacked next to app.asar (see asarUnpack).
    const file = workerPath.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1')
    const worker = new Worker(file, { workerData: job })
    worker.on('message', (m: WorkerMessage) => {
      if (m.type === 'progress') onProgress(m.progress)
      else if (m.type === 'done') resolve(m.result as T)
      else reject(new Error(m.message))
    })
    worker.on('error', reject)
    worker.on('exit', (code) => code !== 0 && reject(new Error(`Worker stopped with code ${code}`)))
  }).finally(() => {
    running = null
  })
  running = { kind: job.kind, promise: p }
  return p
}
