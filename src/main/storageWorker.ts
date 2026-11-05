import { parentPort, workerData } from 'node:worker_threads'
import { mapStorage } from './diskmap'

const post = (m: unknown) => parentPort!.postMessage(m)
try {
  const result = mapStorage(workerData.root as string, (progress) => post({ type: 'progress', progress }))
  post({ type: 'done', result })
} catch (e) {
  post({ type: 'error', message: e instanceof Error ? e.message : String(e) })
}
