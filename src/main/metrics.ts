import { execFile } from 'node:child_process'
import os from 'node:os'
import si from 'systeminformation'
import type { DiskInfo, KillResult, ProcInfo, Snapshot, StaticInfo } from '../shared/types'

export async function getStatic(): Promise<StaticInfo> {
  const [osInfo, cpu] = await Promise.all([si.osInfo(), si.cpu()])
  return {
    platform: process.platform,
    osName: `${osInfo.distro} ${osInfo.release}`.trim(),
    hostname: os.hostname(),
    cpuModel: `${cpu.manufacturer} ${cpu.brand}`.trim(),
    physicalCores: cpu.physicalCores,
    logicalCores: cpu.cores,
    totalMem: os.totalmem()
  }
}

export async function getSnapshot(): Promise<Snapshot> {
  const [load, mem] = await Promise.all([si.currentLoad(), si.mem()])
  const cache = mem.buffcache ?? 0
  return {
    time: Date.now(),
    cpu: load.currentLoad,
    cores: load.cpus.map((c) => c.load),
    mem: {
      total: mem.total,
      used: mem.total - mem.available,
      cache,
      available: mem.available,
      swapTotal: mem.swaptotal,
      swapUsed: mem.swapused
    },
    uptime: os.uptime()
  }
}

const HIDDEN_FS = new Set(['squashfs', 'tmpfs', 'devtmpfs', 'overlay', 'efivarfs', 'ramfs'])

export async function getDisks(): Promise<DiskInfo[]> {
  const list = await si.fsSize()
  const seen = new Set<string>()
  return list
    .filter((d) => d.size > 1e9 && !HIDDEN_FS.has(d.type.toLowerCase()))
    .filter((d) => !/^\/(snap|var\/snap|boot)(\/|$)/.test(d.mount))
    .filter((d) => (seen.has(d.fs) ? false : (seen.add(d.fs), true)))
    .map((d) => ({ mount: d.mount, fs: d.fs, type: d.type, size: d.size, used: d.used }))
}

/** PIDs seen in the previous poll. */
let knownPids = new Set<number>()

export async function getProcesses(): Promise<ProcInfo[]> {
  const { list } = await si.processes()
  const total = os.totalmem()
  // Hide the short-lived helpers systeminformation itself spawns (`sh` → `ps`,
  // PowerShell on Windows): any descendant of this app's main process.
  const ours = new Set([process.pid])
  for (let grew = true; grew; ) {
    grew = false
    for (const p of list) if (ours.has(p.parentPid) && !ours.has(p.pid)) ours.add(p.pid), (grew = true)
  }
  ours.delete(process.pid)

  // systeminformation measures CPU as a share of the whole CPU by comparing two
  // polls. A process that is new since the last poll has no baseline and comes back
  // with a meaningless per-core figure (often 100–500%), so show 0 until measured.
  const previous = knownPids
  knownPids = new Set(list.map((p) => p.pid))

  return list
    .filter((p) => p.pid > 0 && !ours.has(p.pid))
    .map((p) => ({
      pid: p.pid,
      name: p.name,
      cpu: previous.has(p.pid) ? Math.min(100, Math.max(0, p.cpu)) : 0,
      memBytes: p.memRss * 1024,
      memPercent: ((p.memRss * 1024) / total) * 100,
      user: p.user,
      command: [p.path, p.command, p.params].filter(Boolean).join(' ').slice(0, 300)
    }))
    .sort((a, b) => b.cpu - a.cpu || b.memBytes - a.memBytes)
}

function guard(pid: number): KillResult | null {
  if (!Number.isInteger(pid) || pid <= 4 || pid === process.pid || pid === process.ppid) {
    return { ok: false, error: 'This process cannot be ended from here.' }
  }
  return null
}

/**
 * Ends a process. Without `force` the app is asked to close the normal way
 * (SIGTERM on Linux/macOS; on Windows `taskkill` without /F, which sends a close
 * request to the app's windows). With `force` it is terminated immediately.
 */
export async function killProcess(pid: number, force = false): Promise<KillResult> {
  const blocked = guard(pid)
  if (blocked) return blocked

  if (process.platform === 'win32') {
    const args = ['/PID', String(pid), ...(force ? ['/F'] : [])]
    return new Promise((resolve) => {
      execFile('taskkill', args, { windowsHide: true }, (err, _stdout, stderr) => {
        if (!err) return resolve({ ok: true })
        const msg = String(stderr || err.message)
        if (/access is denied/i.test(msg))
          return resolve({ ok: false, error: 'It belongs to the system or another user — ending it needs admin rights.' })
        if (/not found/i.test(msg)) return resolve({ ok: false, error: 'The process has already exited.' })
        // Background processes have no window to close politely.
        if (!force && /forcefully/i.test(msg))
          return resolve({ ok: false, canForce: true, error: 'It has no window to close, so it can only be force-ended.' })
        resolve({ ok: false, error: msg.trim() })
      })
    })
  }

  try {
    process.kill(pid, force ? 'SIGKILL' : 'SIGTERM')
    return { ok: true }
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    if (code === 'EPERM') return { ok: false, error: 'It belongs to the system or another user — ending it needs admin rights.' }
    if (code === 'ESRCH') return { ok: false, error: 'The process has already exited.' }
    return { ok: false, error: String(e) }
  }
}
