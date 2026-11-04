import os from 'node:os'
import path from 'node:path'
import type { TargetInfo } from '../shared/types'

/**
 * A folder the app is allowed to clean. Only the *contents* of `path` are ever
 * removed — never the folder itself and never anything outside it.
 * A path segment of `*` matches any single folder name (e.g. browser profiles).
 */
export interface Root {
  path: string
  /** Absolute paths inside `path` that must be left alone. */
  exclude?: string[]
  /** Only top-level entries whose name matches. */
  match?: RegExp
  /** Only top-level entries not modified for this many hours. */
  olderThanHours?: number
  /** Only entries owned by the current user (unix). */
  ownedOnly?: boolean
}

export interface Target extends Omit<TargetInfo, 'paths'> {
  roots: Root[]
}

const home = os.homedir()
const h = (...p: string[]) => path.join(home, ...p)

// ---------------------------------------------------------------- shared text

const BROWSER = (name: string): Omit<Target, 'id' | 'roots'> => ({
  name: `${name} cache`,
  category: 'browser',
  whatItIs: `Copies of images, scripts and pages ${name} downloaded so websites open faster next time.`,
  gain: 'Frees disk space and fixes pages that look broken or out of date.',
  loss: 'Websites load a bit slower the first time you revisit them. You stay logged in — cookies, passwords, history and bookmarks are NOT touched.',
  risk: 'safe',
  tip: `Close ${name} first so all files can be removed.`
})

const THUMBS: Omit<Target, 'id' | 'roots'> = {
  name: 'Thumbnail cache',
  category: 'system',
  whatItIs: 'Small preview pictures the file manager makes for photos, videos and documents.',
  gain: 'Frees space taken by previews of files you deleted long ago.',
  loss: 'Previews are rebuilt the next time you open a folder, so picture-heavy folders open slower once.',
  risk: 'safe'
}

const TEMP: Omit<Target, 'id' | 'roots'> = {
  name: 'Old temporary files',
  category: 'temp',
  whatItIs: 'Scratch files apps create while working and often forget to delete.',
  gain: 'Frees space. Only files untouched for more than 24 hours are removed.',
  loss: 'Almost nothing. A program that has been open for days could lose a scratch file and may need restarting.',
  risk: 'low'
}

const CRASH: Omit<Target, 'id' | 'roots'> = {
  name: 'Crash reports',
  category: 'system',
  whatItIs: 'Memory dumps saved when an app crashed.',
  gain: 'Frees space — crash dumps can be hundreds of MB each.',
  loss: 'You can no longer send these reports to developers to help fix the crash.',
  risk: 'safe'
}

const TRASH: Omit<Target, 'id' | 'roots'> = {
  name: 'Trash',
  category: 'trash',
  whatItIs: 'Files you deleted that are waiting in the Trash / Recycle Bin.',
  gain: 'Actually frees the space those deleted files still occupy.',
  loss: 'PERMANENT: you can no longer restore anything from the Trash. Check it first if unsure.',
  risk: 'medium'
}

const dev = (
  id: string,
  tool: string,
  roots: Root[],
  extra = 'Projects keep working; the next install just downloads packages again.',
  whatItIs = `Packages ${tool} downloaded earlier so it can reinstall them without the internet.`
): Target => ({
  id,
  name: `${tool} cache`,
  category: 'developer',
  whatItIs,
  gain: 'Often frees several GB on developer machines.',
  loss: `${extra} Installs are slower and need internet until the cache refills.`,
  risk: 'low',
  roots
})

const APPS: Omit<Target, 'id' | 'roots'> = {
  name: 'Desktop app caches',
  category: 'apps',
  whatItIs: 'Web caches and GPU shader caches of apps such as VS Code, Discord, Slack, Teams and Spotify.',
  gain: 'Frees space and can fix apps that show stale or glitchy content.',
  loss: 'These apps start a little slower once and re-download images. Your messages, settings and logins are kept.',
  risk: 'low',
  tip: 'Close these apps first so all files can be removed.'
}

// Sub-folders of Electron/Chromium apps that are pure cache.
const CHROMIUM_CACHE_DIRS = ['Cache', 'Code Cache', 'GPUCache', 'DawnCache', 'DawnGraphiteCache', 'DawnWebGPUCache', 'CachedData', 'CachedExtensionVSIXs', 'Service Worker/CacheStorage']
const ELECTRON_APPS = ['Code', 'Code - Insiders', 'VSCodium', 'Cursor', 'discord', 'Slack', 'Microsoft Teams', 'Signal', 'Postman', 'Notion', 'obsidian', 'Spotify']
const appCacheRoots = (base: string): Root[] =>
  ELECTRON_APPS.flatMap((app) => CHROMIUM_CACHE_DIRS.map((d) => ({ path: path.join(base, app, d) })))

// ---------------------------------------------------------------- per OS

function linuxTargets(): Target[] {
  const cache = h('.cache')
  const browserCaches: Record<string, { name: string; paths: string[] }> = {
    chrome: { name: 'Google Chrome', paths: [path.join(cache, 'google-chrome')] },
    chromium: { name: 'Chromium', paths: [path.join(cache, 'chromium'), h('snap/chromium/common/.cache/chromium')] },
    brave: { name: 'Brave', paths: [path.join(cache, 'BraveSoftware')] },
    edge: { name: 'Microsoft Edge', paths: [path.join(cache, 'microsoft-edge')] },
    firefox: { name: 'Firefox', paths: [path.join(cache, 'mozilla'), h('snap/firefox/common/.cache/mozilla')] },
    opera: { name: 'Opera', paths: [path.join(cache, 'opera')] },
    vivaldi: { name: 'Vivaldi', paths: [path.join(cache, 'vivaldi')] }
  }

  const devTargets: Target[] = [
    dev('npm', 'npm', [{ path: h('.npm/_cacache') }]),
    dev('pnpm', 'pnpm', [{ path: h('.local/share/pnpm/store') }, { path: path.join(cache, 'pnpm') }]),
    dev('yarn', 'Yarn', [{ path: path.join(cache, 'yarn') }]),
    dev('pip', 'pip', [{ path: path.join(cache, 'pip') }]),
    dev('go', 'Go build', [{ path: path.join(cache, 'go-build') }], 'Go programs keep working; the next build is slower.', 'Compiled pieces Go keeps so it can rebuild programs faster.'),
    dev('gradle', 'Gradle', [{ path: h('.gradle/caches') }])
  ]

  const models: Target = {
    id: 'models',
    name: 'Downloaded AI models & test browsers',
    category: 'developer',
    whatItIs: 'Large files downloaded by tools like Hugging Face, PyTorch and Playwright.',
    gain: 'Can free many GB at once.',
    loss: 'Tools that use these models or browsers must download them again — this can take a long time and lots of data.',
    risk: 'medium',
    roots: [path.join(cache, 'huggingface'), path.join(cache, 'torch'), path.join(cache, 'ms-playwright')].map((p) => ({ path: p }))
  }

  const thumbs = path.join(cache, 'thumbnails')
  const covered = [
    thumbs,
    ...Object.values(browserCaches).flatMap((b) => b.paths),
    ...devTargets.flatMap((t) => t.roots.map((r) => r.path)),
    ...models.roots.map((r) => r.path)
  ].filter((p) => p.startsWith(cache + path.sep))

  return [
    ...Object.entries(browserCaches).map(([id, b]) => ({ id: `browser-${id}`, ...BROWSER(b.name), roots: b.paths.map((p) => ({ path: p })) })),
    { id: 'thumbnails', ...THUMBS, roots: [{ path: thumbs }] },
    {
      id: 'user-cache',
      name: 'Other app caches',
      category: 'apps',
      whatItIs: 'Everything else in ~/.cache — the standard place Linux apps keep re-creatable data.',
      gain: 'Frees space left behind by apps you use, and by apps you uninstalled long ago.',
      loss: 'Apps rebuild what they need, so some start slower once. A few apps keep offline data here and may need to download it again.',
      risk: 'low',
      roots: [{ path: cache, exclude: covered }]
    },
    { id: 'app-caches', ...APPS, roots: appCacheRoots(h('.config')) },
    ...devTargets,
    models,
    { id: 'trash', ...TRASH, roots: [{ path: h('.local/share/Trash/files') }, { path: h('.local/share/Trash/info') }, { path: h('.local/share/Trash/expunged') }] },
    { id: 'temp', ...TEMP, roots: [{ path: os.tmpdir(), olderThanHours: 24, ownedOnly: true }] },
    { id: 'crash', ...CRASH, roots: [{ path: '/var/crash', ownedOnly: true }] },
    {
      id: 'apt',
      name: 'Package installer cache',
      category: 'system',
      whatItIs: 'Copies of every .deb package APT has downloaded for updates.',
      gain: 'Frees space; installed software is not affected.',
      loss: 'Reinstalling the same version of a package needs to download it again.',
      risk: 'safe',
      manualCommand: 'sudo apt clean',
      roots: [{ path: '/var/cache/apt/archives', match: /\.deb$/ }]
    },
    {
      id: 'journal',
      name: 'System logs',
      category: 'system',
      whatItIs: 'The systemd journal: a record of everything the system has logged.',
      gain: 'Frees space; the system keeps logging normally.',
      loss: 'You lose old logs that help diagnose past problems (logs from the last 7 days are kept).',
      risk: 'low',
      manualCommand: 'sudo journalctl --vacuum-time=7d',
      roots: [{ path: '/var/log/journal' }]
    }
  ]
}

function windowsTargets(): Target[] {
  const local = process.env.LOCALAPPDATA ?? h('AppData/Local')
  const roaming = process.env.APPDATA ?? h('AppData/Roaming')
  const chromium = (base: string) =>
    ['Cache', 'Code Cache', 'GPUCache'].map((d) => ({ path: path.join(base, 'User Data', '*', d) }))

  return [
    { id: 'browser-chrome', ...BROWSER('Google Chrome'), roots: chromium(path.join(local, 'Google/Chrome')) },
    { id: 'browser-edge', ...BROWSER('Microsoft Edge'), roots: chromium(path.join(local, 'Microsoft/Edge')) },
    { id: 'browser-brave', ...BROWSER('Brave'), roots: chromium(path.join(local, 'BraveSoftware/Brave-Browser')) },
    { id: 'browser-firefox', ...BROWSER('Firefox'), roots: [{ path: path.join(local, 'Mozilla/Firefox/Profiles/*/cache2') }] },
    { id: 'thumbnails', ...THUMBS, roots: [{ path: path.join(local, 'Microsoft/Windows/Explorer'), match: /^(thumbcache|iconcache)_.*\.db$/i }] },
    { id: 'app-caches', ...APPS, roots: appCacheRoots(roaming) },
    dev('npm', 'npm', [{ path: path.join(local, 'npm-cache/_cacache') }]),
    dev('pnpm', 'pnpm', [{ path: path.join(local, 'pnpm/store') }]),
    dev('yarn', 'Yarn', [{ path: path.join(local, 'Yarn/Cache') }]),
    dev('pip', 'pip', [{ path: path.join(local, 'pip/Cache') }]),
    { id: 'temp', ...TEMP, roots: [{ path: os.tmpdir(), olderThanHours: 24 }] },
    { id: 'crash', ...CRASH, roots: [{ path: path.join(local, 'CrashDumps') }] },
    {
      id: 'recycle',
      ...TRASH,
      manualCommand: 'Right-click the Recycle Bin on the desktop → Empty Recycle Bin',
      roots: []
    },
    {
      id: 'win-temp',
      name: 'Windows temp & update files',
      category: 'system',
      whatItIs: 'System temp files and already-installed Windows Update downloads.',
      gain: 'Often frees several GB.',
      loss: 'You may not be able to uninstall recent Windows updates.',
      risk: 'low',
      manualCommand: 'Run "Disk Cleanup" (cleanmgr) as administrator → Clean up system files',
      roots: [{ path: 'C:\\Windows\\Temp' }, { path: 'C:\\Windows\\SoftwareDistribution\\Download' }]
    }
  ]
}

function macTargets(): Target[] {
  const caches = h('Library/Caches')
  const browsers: Record<string, [string, string[]]> = {
    chrome: ['Google Chrome', [path.join(caches, 'Google/Chrome')]],
    firefox: ['Firefox', [path.join(caches, 'Firefox')]],
    brave: ['Brave', [path.join(caches, 'BraveSoftware')]],
    edge: ['Microsoft Edge', [path.join(caches, 'Microsoft Edge')]]
  }
  const devTargets = [
    dev('npm', 'npm', [{ path: h('.npm/_cacache') }]),
    dev('pnpm', 'pnpm', [{ path: h('Library/pnpm/store') }]),
    dev('yarn', 'Yarn', [{ path: path.join(caches, 'Yarn') }]),
    dev('pip', 'pip', [{ path: path.join(caches, 'pip') }]),
    dev('xcode', 'Xcode build', [{ path: h('Library/Developer/Xcode/DerivedData') }], 'Projects keep working; the next Xcode build takes longer.', 'Build output and indexes Xcode keeps so projects rebuild faster.')
  ]
  const covered = [...Object.values(browsers).flatMap((b) => b[1]), ...devTargets.flatMap((t) => t.roots.map((r) => r.path))]
  return [
    ...Object.entries(browsers).map(([id, [name, paths]]) => ({ id: `browser-${id}`, ...BROWSER(name), roots: paths.map((p) => ({ path: p })) })),
    {
      id: 'user-cache',
      name: 'Other app caches',
      category: 'apps',
      whatItIs: 'Everything else in ~/Library/Caches — re-creatable data kept by macOS apps.',
      gain: 'Frees space, including leftovers of uninstalled apps.',
      loss: 'Apps rebuild what they need and may start slower once.',
      risk: 'low',
      roots: [{ path: caches, exclude: covered }]
    },
    { id: 'app-caches', ...APPS, roots: appCacheRoots(h('Library/Application Support')) },
    ...devTargets,
    {
      id: 'logs',
      name: 'App logs',
      category: 'system',
      whatItIs: 'Diagnostic log files written by apps.',
      gain: 'Frees space.',
      loss: 'Old logs that might help diagnose a past problem are gone.',
      risk: 'safe',
      roots: [{ path: h('Library/Logs') }]
    },
    { id: 'trash', ...TRASH, tip: 'If the size shows 0, give Resource Viewer "Full Disk Access" in System Settings.', roots: [{ path: h('.Trash') }] },
    { id: 'temp', ...TEMP, roots: [{ path: os.tmpdir(), olderThanHours: 24, ownedOnly: true }] }
  ]
}

let cached: Target[] | null = null

export function getTargets(): Target[] {
  if (!cached) {
    cached =
      process.platform === 'win32' ? windowsTargets() : process.platform === 'darwin' ? macTargets() : linuxTargets()
  }
  return cached
}

export function toInfo(t: Target, resolvedPaths: string[]): TargetInfo {
  const { roots: _roots, ...info } = t
  return { ...info, paths: resolvedPaths }
}
