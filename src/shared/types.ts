export type Risk = 'safe' | 'low' | 'medium'

export type Category = 'browser' | 'system' | 'apps' | 'developer' | 'trash' | 'temp'

/** Everything the UI needs to explain a cleanup target. Paths are display-only. */
export interface TargetInfo {
  id: string
  name: string
  category: Category
  /** Plain-language description of what is stored here. */
  whatItIs: string
  /** What the user gets by cleaning it. */
  gain: string
  /** What the user may lose or notice afterwards. */
  loss: string
  risk: Risk
  /** Tip shown before cleaning, e.g. "Close Chrome first". */
  tip?: string
  /** Set when the app cannot clean it (needs admin). The user can run this command. */
  manualCommand?: string
  paths: string[]
}

export interface ScanResult extends TargetInfo {
  bytes: number
  files: number
  /** Entries that could not be read (permissions). */
  unreadable: number
}

export interface CleanResult {
  id: string
  freedBytes: number
  deletedFiles: number
  /** Files that were locked or not permitted. */
  skipped: number
}

export interface ScanProgress {
  done: number
  total: number
  current: string
}

export interface StaticInfo {
  platform: NodeJS.Platform
  osName: string
  hostname: string
  cpuModel: string
  physicalCores: number
  logicalCores: number
  totalMem: number
}

export interface Snapshot {
  time: number
  cpu: number
  cores: number[]
  mem: {
    total: number
    /** Memory used by programs (excludes reclaimable file cache). */
    used: number
    /** Reclaimable file cache — the OS frees this automatically. */
    cache: number
    available: number
    swapTotal: number
    swapUsed: number
  }
  uptime: number
}

export interface DiskInfo {
  mount: string
  fs: string
  type: string
  size: number
  used: number
}

export interface ProcInfo {
  pid: number
  name: string
  cpu: number
  memBytes: number
  memPercent: number
  user: string
  command: string
}

export interface KillResult {
  ok: boolean
  error?: string
  /** The polite close failed but a forced end is possible. */
  canForce?: boolean
}

export interface WindowControls {
  platform: NodeJS.Platform
  minimize(): Promise<void>
  toggleMaximize(): Promise<void>
  close(): Promise<void>
  isMaximized(): Promise<boolean>
  onMaximizedChange(cb: (maximized: boolean) => void): () => void
}

export interface Api {
  win: WindowControls
  getStatic(): Promise<StaticInfo>
  getSnapshot(): Promise<Snapshot>
  getDisks(): Promise<DiskInfo[]>
  getProcesses(): Promise<ProcInfo[]>
  killProcess(pid: number, force?: boolean): Promise<KillResult>
  scan(): Promise<ScanResult[]>
  clean(ids: string[]): Promise<CleanResult[]>
  openTarget(id: string): Promise<void>
  onScanProgress(cb: (p: ScanProgress) => void): () => void
  storage: {
    /** Resolves null when the folder picker is cancelled. */
    scan(scope: StorageScope): Promise<StorageResult | null>
    cancel(): Promise<void>
    /** Shows a path from the last scan in the file manager. */
    reveal(path: string): Promise<void>
    onProgress(cb: (p: StorageProgress) => void): () => void
  }
}

/** One entry in the storage map. Short keys keep large trees cheap to send over IPC. */
export interface DiskNode {
  /** Name (not the full path). */
  n: string
  /** Bytes on disk. */
  s: number
  /** 'd' folder, 'f' file, 'r' many small items merged into one slice. */
  k: 'd' | 'f' | 'r'
  c?: DiskNode[]
  /** For 'r' nodes: how many items were merged. */
  m?: number
}

export type StorageScope = 'home' | 'disk' | 'pick'

export interface StorageResult {
  root: string
  sep: string
  tree: DiskNode
  files: number
  folders: number
  unreadable: number
  ms: number
}

export interface StorageProgress {
  files: number
  bytes: number
  current: string
}
