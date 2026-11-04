# Resource Viewer — Plan

A small Electron desktop app that shows live system usage, finds caches and junk files
that slow the PC down, and lets the user clean them. Before anything is deleted, the app
explains **what you gain** and **what you might lose**.

## 1. Stack

| Layer | Choice | Why |
|---|---|---|
| Shell | Electron + `electron-vite` | Fast dev server, separate main/preload/renderer builds |
| UI | React 19 + TypeScript | |
| Styling | Tailwind CSS v4 + shadcn/ui | Ready-made accessible components |
| Charts (static) | shadcn `chart` (Recharts) | Disk donut, cache breakdown bars |
| Charts (live) | D3 (`d3-scale`, `d3-shape`) drawing to `<canvas>` | Live CPU/RAM graph redraws every second without React re-rendering SVG nodes |
| System data | `systeminformation` | CPU, RAM, disks, processes on Linux / Windows / macOS |

## 2. Architecture

```
main process (Node)            preload (contextBridge)          renderer (React)
  ├─ metrics.ts  ── CPU/RAM/disk/processes ─┐
  ├─ cleaners.ts ── cache target catalogue  ├─ window.api.* ──►  Overview / Cleanup / Processes tabs
  ├─ scan.ts     ── folder size walker      │
  └─ ipc.ts      ── ipcMain.handle(...)  ───┘
```

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` on the renderer.
- The renderer never sends a file path to delete. It only sends **target IDs**; the main
  process resolves the IDs to paths from its own allow-list.

## 3. Cleanup catalogue (each target has gain / loss / risk)

Every target has: `id, name, category, paths[], whatItIs, gain, loss, risk (safe|low|medium), needsAdmin`.

Linux (primary), plus Windows and macOS equivalents:
- App & user cache (`~/.cache` minus items listed separately)
- Thumbnail cache
- Browser caches (Chrome, Chromium, Brave, Edge, Firefox) — cache only, never cookies/passwords/history
- Developer caches (npm, pip, yarn, pnpm store)
- VS Code / Electron app caches
- Trash / Recycle bin
- Old temp files (only the user's own files older than 24 h)
- Crash reports
- System-level (apt cache, journal logs, `C:\Windows\Temp`): shown with size and the command to run, but not cleaned by the app because they need admin rights

## 4. Screens

1. **Overview** — live CPU & RAM line chart (D3 canvas, 60 s window), per-core load bars,
   RAM breakdown, disk usage donut (shadcn chart), uptime / OS info.
2. **Cleanup** — "Scan" button → table of targets with size, risk badge and checkbox;
   bar chart of space per category; each row expands to show *What it is / You gain /
   You might lose*. "Clean selected" opens a confirm dialog summarising every loss,
   then shows how much space was freed.
3. **Processes** — top processes by CPU / RAM, with "End process" + confirm dialog
   explaining that unsaved work in that app is lost.

## 5. Safety rules

- Delete contents of an allow-listed folder, never the folder itself, never outside it.
- Use `lstat`; never follow symlinks.
- Skip files that are locked or need permissions; report the count.
- Temp folder: only files owned by the current user and older than 24 h.
- Scan first, clean only after confirmation.

## 6. Steps

- [x] 1. Scaffold electron-vite + React + TS, Tailwind v4, shadcn (components.json + alias).
- [x] 2. Main process: metrics, catalogue, size scanner, cleaner, IPC; typed preload API.
      (Scanner moved to a worker thread with sync fs — 63 s → 3.5 s on 400k files.)
- [x] 3. Renderer: layout + tabs, Overview (D3 live chart + shadcn charts).
- [x] 4. Cleanup tab with explanations, confirm dialog, results.
- [x] 5. Processes tab with end-process confirm.
- [x] 6. Typecheck, build, launch and screenshot to verify; write README.
