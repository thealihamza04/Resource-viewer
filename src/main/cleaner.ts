/**
 * Scanning and cleaning. Runs inside a worker thread (see cleanWorker.ts) and
 * uses synchronous fs calls on purpose: walking ~400k cache files this way takes
 * ~3 s, versus ~60 s with one promise per file on libuv's small thread pool.
 */
import fs, { type Stats } from 'node:fs'
import path from 'node:path'
import type { CleanResult, ScanProgress, ScanResult } from '../shared/types'
import { getTargets, toInfo, type Root, type Target } from './targets'

const uid = typeof process.getuid === 'function' ? process.getuid() : undefined

function lstat(p: string): Stats | null {
  try {
    return fs.lstatSync(p)
  } catch {
    return null
  }
}
function readdir(p: string): string[] | null {
  try {
    return fs.readdirSync(p)
  } catch {
    return null
  }
}
function realOrSelf(p: string): string {
  try {
    return fs.realpathSync(p)
  } catch {
    return p
  }
}

/** Space actually released by deleting this file. Hard-linked files free nothing. */
function bytesFreed(st: Stats): number {
  if (st.nlink > 1) return 0
  return process.platform !== 'win32' && st.blocks ? st.blocks * 512 : st.size
}

function isInside(root: string, p: string): boolean {
  const rel = path.relative(root, p)
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
}

/** A resolved root: a real, existing directory plus the filters that apply to it. */
interface Resolved {
  dir: string
  root: Root
  excludes: Set<string>
  cutoff?: number
}

/** Expands `*` segments and resolves symlinks in the root path itself. */
function expand(pattern: string): string[] {
  const parts = pattern.split(path.sep).filter(Boolean)
  let bases = [pattern.startsWith(path.sep) ? path.sep : parts.shift()! + path.sep]
  for (const part of parts) {
    bases = bases.flatMap((base) =>
      part === '*' ? (readdir(base) ?? []).map((n) => path.join(base, n)) : [path.join(base, part)]
    )
  }
  return bases.map(realOrSelf).filter((p) => lstat(p)?.isDirectory())
}

function resolveTarget(t: Target): Resolved[] {
  const out: Resolved[] = []
  for (const root of t.roots) {
    const excludes = new Set((root.exclude ?? []).map(realOrSelf))
    const cutoff = root.olderThanHours ? Date.now() - root.olderThanHours * 3_600_000 : undefined
    for (const dir of expand(root.path)) {
      if (!out.some((o) => o.dir === dir)) out.push({ dir, root, excludes, cutoff })
    }
  }
  return out
}

/** Should this entry be touched at all? */
function eligible(r: Resolved, p: string, st: Stats, topLevel: boolean): boolean {
  if (r.excludes.has(p)) return false
  // Never touch sockets, pipes or devices (e.g. ssh-agent / tmux sockets in /tmp).
  if (!st.isFile() && !st.isDirectory() && !st.isSymbolicLink()) return false
  if (r.root.ownedOnly && uid !== undefined && st.uid !== uid) return false
  if (topLevel && r.root.match && !r.root.match.test(path.basename(p))) return false
  if (r.cutoff && !st.isDirectory() && st.mtimeMs > r.cutoff) return false
  return true
}

// ------------------------------------------------------------- scanning

interface Tally {
  bytes: number
  files: number
  unreadable: number
}

function measure(r: Resolved, p: string, topLevel: boolean, t: Tally): void {
  const st = lstat(p)
  if (!st) return void t.unreadable++
  if (!eligible(r, p, st, topLevel)) return
  if (st.isDirectory()) {
    const names = readdir(p)
    if (!names) return void t.unreadable++
    for (const n of names) measure(r, path.join(p, n), false, t)
  } else {
    t.bytes += bytesFreed(st)
    t.files++
  }
}

function scanTarget(t: Target): ScanResult {
  const resolved = resolveTarget(t)
  const tally: Tally = { bytes: 0, files: 0, unreadable: 0 }
  for (const r of resolved) {
    const names = readdir(r.dir)
    if (!names) tally.unreadable++
    else for (const n of names) measure(r, path.join(r.dir, n), true, tally)
  }
  return { ...toInfo(t, resolved.map((r) => r.dir)), ...tally }
}

export function scanAll(onProgress: (p: ScanProgress) => void): ScanResult[] {
  const targets = getTargets()
  const results: ScanResult[] = []
  targets.forEach((t, i) => {
    onProgress({ done: i, total: targets.length, current: t.name })
    results.push(scanTarget(t))
  })
  onProgress({ done: targets.length, total: targets.length, current: '' })
  // Hide targets that don't exist on this machine (e.g. browsers not installed).
  return results.filter((r) => r.paths.length > 0)
}

// ------------------------------------------------------------- cleaning

interface CleanTally {
  freed: number
  deleted: number
  skipped: number
}

/** Deletes `p` (recursively) if allowed. Returns true when it is completely gone. */
function remove(r: Resolved, p: string, topLevel: boolean, t: CleanTally): boolean {
  if (!isInside(r.dir, p)) throw new Error(`Refusing to touch ${p}: outside ${r.dir}`)
  const st = lstat(p)
  if (!st || !eligible(r, p, st, topLevel)) return false

  if (st.isDirectory()) {
    const names = readdir(p)
    if (!names) {
      t.skipped++
      return false
    }
    let allGone = true
    for (const n of names) allGone = remove(r, path.join(p, n), false, t) && allGone
    if (!allGone) return false
    try {
      fs.rmdirSync(p)
      return true
    } catch {
      return false
    }
  }

  // Files and symlinks: unlink removes the link itself, never what it points to.
  try {
    fs.unlinkSync(p)
    t.freed += bytesFreed(st)
    t.deleted++
    return true
  } catch {
    t.skipped++
    return false
  }
}

export function cleanTargets(ids: string[], onProgress: (p: ScanProgress) => void): CleanResult[] {
  const targets = getTargets().filter((t) => ids.includes(t.id) && !t.manualCommand)
  return targets.map((t, i) => {
    onProgress({ done: i, total: targets.length, current: t.name })
    const tally: CleanTally = { freed: 0, deleted: 0, skipped: 0 }
    for (const r of resolveTarget(t)) {
      for (const n of readdir(r.dir) ?? []) remove(r, path.join(r.dir, n), true, tally)
    }
    return { id: t.id, freedBytes: tally.freed, deletedFiles: tally.deleted, skipped: tally.skipped }
  })
}

export function targetFolder(id: string): string | undefined {
  const t = getTargets().find((x) => x.id === id)
  return t ? resolveTarget(t)[0]?.dir : undefined
}
