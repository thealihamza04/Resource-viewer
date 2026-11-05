/**
 * Read-only storage map. Walks a folder tree with synchronous fs calls (inside a
 * worker thread, see storageWorker.ts) and returns sizes on disk.
 *
 * - Never follows symlinks and never leaves the starting device, so /proc, /sys,
 *   network mounts and other drives are not counted.
 * - Hard-linked files are counted once.
 * - Items under 1 MB are merged into one "smaller items" slice per folder, which
 *   keeps the tree small enough to send to the window and to draw.
 */
import fs from 'node:fs'
import path from 'node:path'
import type { DiskNode, StorageProgress, StorageResult } from '../shared/types'

const MIN_BYTES = 1024 * 1024
const MAX_CHILDREN = 150

export function mapStorage(root: string, onProgress: (p: StorageProgress) => void): StorageResult {
  const started = Date.now()
  const rootStat = fs.lstatSync(root)
  const dev = rootStat.dev
  const seenLinks = new Set<string>()
  const useBlocks = process.platform !== 'win32'
  let files = 0
  let folders = 0
  let unreadable = 0
  let bytes = 0
  let lastReport = 0

  const sizeOf = (st: fs.Stats): number => {
    if (st.nlink > 1) {
      const key = `${st.dev}:${st.ino}`
      if (seenLinks.has(key)) return 0
      seenLinks.add(key)
    }
    return useBlocks && st.blocks !== undefined ? st.blocks * 512 : st.size
  }

  const walk = (dir: string, name: string): DiskNode => {
    folders++
    let names: string[]
    try {
      names = fs.readdirSync(dir)
    } catch {
      unreadable++
      return { n: name, s: 0, k: 'd' }
    }
    const kids: DiskNode[] = []
    let total = 0
    for (const child of names) {
      const p = path.join(dir, child)
      let st: fs.Stats
      try {
        st = fs.lstatSync(p)
      } catch {
        unreadable++
        continue
      }
      let node: DiskNode
      if (st.isDirectory()) {
        if (st.dev !== dev) continue // another drive or a virtual file system
        node = walk(p, child)
      } else {
        files++
        // Symlinks count as their own tiny size; sockets/devices take no space.
        node = { n: child, s: st.isFile() || st.isSymbolicLink() ? sizeOf(st) : 0, k: 'f' }
        bytes += node.s
        if ((files & 1023) === 0) {
          const now = Date.now()
          if (now - lastReport > 150) {
            lastReport = now
            onProgress({ files, bytes, current: dir })
          }
        }
      }
      total += node.s
      if (node.s > 0) kids.push(node)
    }
    return { n: name, s: total, k: 'd', ...(kids.length ? { c: prune(kids) } : {}) }
  }

  const tree = walk(root, root)
  onProgress({ files, bytes, current: root })
  return { root, sep: path.sep, tree, files, folders, unreadable, ms: Date.now() - started }
}

/** Keeps the big entries and merges the rest into one "smaller items" slice. */
function prune(kids: DiskNode[]): DiskNode[] {
  kids.sort((a, b) => b.s - a.s)
  const keep: DiskNode[] = []
  let restBytes = 0
  let restCount = 0
  for (const k of kids) {
    if (k.s >= MIN_BYTES && keep.length < MAX_CHILDREN) keep.push(k)
    else {
      restBytes += k.s
      restCount += k.m ?? 1
    }
  }
  if (restBytes > 0) keep.push({ n: `${restCount} smaller items`, s: restBytes, k: 'r', m: restCount })
  // Drop the children of folders whose content is all small: one slice says enough.
  for (const k of keep) if (k.c && k.c.length === 1 && k.c[0].k === 'r') delete k.c
  return keep
}
