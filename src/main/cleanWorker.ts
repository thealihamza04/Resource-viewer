import { parentPort, workerData } from 'node:worker_threads'
import { cleanTargets, scanAll } from './cleaner'
import type { ScanProgress } from '../shared/types'

export type Job = { kind: 'scan' } | { kind: 'clean'; ids: string[] }
export type WorkerMessage =
  | { type: 'progress'; progress: ScanProgress }
  | { type: 'done'; result: unknown }
  | { type: 'error'; message: string }

const job = workerData as Job
const post = (m: WorkerMessage) => parentPort!.postMessage(m)
const progress = (p: ScanProgress) => post({ type: 'progress', progress: p })

try {
  const result = job.kind === 'scan' ? scanAll(progress) : cleanTargets(job.ids, progress)
  post({ type: 'done', result })
} catch (e) {
  post({ type: 'error', message: e instanceof Error ? e.message : String(e) })
}
