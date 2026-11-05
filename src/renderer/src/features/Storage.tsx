import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronRight, FolderOpen, FolderSearch, HardDrive, Home, Square, CornerLeftUp } from 'lucide-react'
import { hierarchy, partition, type HierarchyRectangularNode } from 'd3-hierarchy'
import type { DiskNode, StorageProgress, StorageResult, StorageScope } from '../../../shared/types'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { formatBytes, formatPercent } from '@/lib/format'
import { cn } from '@/lib/utils'

type Node = HierarchyRectangularNode<DiskNode>
interface Box {
  x0: number
  x1: number
  y0: number
  y1: number
}

/** Rings shown at once around the centre, like Filelight. */
const RINGS = 5
const SIZE = 560
const HOLE = 70
const RING = (SIZE / 2 - HOLE - 6) / RINGS
/** Slices thinner than this (radians) are not drawn. */
const MIN_ANGLE = 0.008
const TWEEN_MS = 450

export function Storage({ active }: { active: boolean }) {
  const [result, setResult] = useState<StorageResult | null>(null)
  const [progress, setProgress] = useState<StorageProgress | null>(null)
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => window.api.storage.onProgress(setProgress), [])

  const scan = async (scope: StorageScope) => {
    setError(null)
    setScanning(true)
    setProgress(null)
    try {
      const r = await window.api.storage.scan(scope)
      if (r) setResult(r)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (!/stopped/i.test(msg)) setError(msg.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    } finally {
      setScanning(false)
    }
  }

  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-5">
      <Card className="min-w-0">
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-4">
          <div className="space-y-1.5">
            <CardTitle>Storage map</CardTitle>
            <CardDescription>
              See which folders take up your disk. Read-only: nothing is changed or deleted here.
            </CardDescription>
          </div>
          {scanning ? (
            <Button variant="outline" onClick={() => window.api.storage.cancel()}>
              <Square /> Stop
            </Button>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => scan('home')}>
                <Home /> Home folder
              </Button>
              <Button variant="outline" onClick={() => scan('disk')}>
                <HardDrive /> Whole disk
              </Button>
              <Button variant="outline" onClick={() => scan('pick')}>
                <FolderSearch /> Choose folder…
              </Button>
            </div>
          )}
        </CardHeader>
        {(scanning || result || error) && (
          <CardContent className="text-muted-foreground min-w-0 text-sm">
            {scanning ? (
              <div className="min-w-0 space-y-0.5">
                <p className="text-foreground font-medium tabular-nums">
                  Scanning… {(progress?.files ?? 0).toLocaleString()} files, {formatBytes(progress?.bytes ?? 0)}
                </p>
                {/* Long paths are cut with … so they can never widen the page. */}
                <p className="truncate text-xs" title={progress?.current}>
                  {progress?.current ?? '\u00a0'}
                </p>
              </div>
            ) : error ? (
              <p className="text-destructive break-words">Couldn’t scan: {error}</p>
            ) : result ? (
              <p className="tabular-nums">
                {result.files.toLocaleString()} files in {result.folders.toLocaleString()} folders, scanned in{' '}
                {(result.ms / 1000).toFixed(1)} s.
                {result.unreadable > 0 && ` ${result.unreadable.toLocaleString()} items couldn’t be read (no permission).`}
              </p>
            ) : null}
          </CardContent>
        )}
      </Card>

      {result ? (
        active && <StorageMap key={result.root + result.ms} result={result} />
      ) : (
        <Card>
          <CardContent className="text-muted-foreground flex flex-col items-center gap-3 py-16 text-center text-sm">
            <HardDrive className="size-10 opacity-40" />
            <p className="max-w-sm">
              Pick a place to map. Your home folder is the quickest; the whole disk can take a minute.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

/** Hue by angle around the circle, a little lighter for each ring outwards. */
function colorFor(d: Node, t: Box): string {
  if (d.data.k === 'r') return 'color-mix(in oklch, var(--muted-foreground) 30%, var(--card))'
  const hue = (((t.x0 + t.x1) / 2 / (2 * Math.PI)) * 330 + 15) % 360
  const ring = Math.max(0, t.y0 - 1)
  return `oklch(${0.64 + ring * 0.045} ${0.15 - ring * 0.012} ${hue.toFixed(1)})`
}

function pathOf(d: Node, sep: string): string {
  const names = d.ancestors().reverse().map((a) => a.data.n)
  const [root, ...rest] = names
  if (!rest.length) return root
  return root.endsWith(sep) ? root + rest.join(sep) : [root, ...rest].join(sep)
}

function StorageMap({ result }: { result: StorageResult }) {
  const root = useMemo<Node>(() => {
    const h = hierarchy(result.tree, (d) => d.c)
      .sum((d) => (d.c ? 0 : d.s))
      // Biggest first, the merged "smaller items" slice always last.
      .sort((a, b) => Number(a.data.k === 'r') - Number(b.data.k === 'r') || (b.value ?? 0) - (a.value ?? 0))
    return partition<DiskNode>().size([2 * Math.PI, h.height + 1])(h)
  }, [result])

  const [focus, setFocus] = useState<Node>(root)
  const [hover, setHover] = useState<{ node: Node; x: number; y: number } | null>(null)

  /** Where each slice sits for a given focus, in angle (x) and ring (y). */
  const target = useCallback(
    (d: Node, p: Node): Box => ({
      x0: Math.max(0, Math.min(1, (d.x0 - p.x0) / (p.x1 - p.x0))) * 2 * Math.PI,
      x1: Math.max(0, Math.min(1, (d.x1 - p.x0) / (p.x1 - p.x0))) * 2 * Math.PI,
      y0: Math.max(0, d.y0 - p.depth),
      y1: Math.max(0, d.y1 - p.depth)
    }),
    []
  )
  const visible = (b: Box) => b.y0 >= 1 && b.y1 <= RINGS + 1 && b.x1 - b.x0 > MIN_ANGLE

  // Canvas renderer: every frame redraws all slices in one pass, no DOM work, so zooms stay smooth.
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const shown = useRef<Node[]>([])
  const boxes = useRef(new Map<Node, Box>())
  const hoverRef = useRef<Node | null>(null)
  const scaleRef = useRef(1)
  const focusRef = useRef<Node>(root)
  const animating = useRef(false)

  /** Slices worth drawing for a focus; skips whole subtrees that are too thin or too deep. */
  const visibleFor = useCallback(
    (p: Node): Node[] => {
      const out: Node[] = []
      const visit = (d: Node) => {
        const b = target(d, p)
        if (b.x1 - b.x0 <= MIN_ANGLE || b.y0 > RINGS) return
        if (b.y0 >= 1) out.push(d)
        d.children?.forEach(visit)
      }
      root.children?.forEach(visit)
      return out
    },
    [root, target]
  )

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const dpr = window.devicePixelRatio || 1
    const k = scaleRef.current * dpr
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.setTransform(k, 0, 0, k, canvas.width / 2, canvas.height / 2)
    const css = getComputedStyle(canvas)
    const gap = css.getPropertyValue('--card').trim() || '#fff'
    const rest = css.getPropertyValue('--muted-foreground').trim() || '#888'
    const hov = hoverRef.current
    const lit = hov ? new Set(hov.ancestors()) : null
    ctx.lineWidth = 1 / scaleRef.current
    ctx.lineJoin = 'round'
    ctx.strokeStyle = gap
    for (const d of shown.current) {
      const b = boxes.current.get(d)
      if (!b || b.y0 < 0.999 || b.y1 > RINGS + 1.001 || b.x1 - b.x0 < 0.0005) continue
      const r0 = HOLE + (b.y0 - 1) * RING
      const r1 = Math.max(r0 + 0.5, HOLE + (b.y1 - 1) * RING - 1.5)
      const a0 = b.x0 - Math.PI / 2
      const a1 = b.x1 - Math.PI / 2
      ctx.beginPath()
      ctx.arc(0, 0, r1, a0, a1)
      ctx.arc(0, 0, r0, a1, a0, true)
      ctx.closePath()
      const dim = lit && !lit.has(d) ? 0.6 : 1
      if (d.data.k === 'r') {
        ctx.globalAlpha = 0.28 * dim
        ctx.fillStyle = rest
      } else {
        ctx.globalAlpha = dim
        ctx.fillStyle = colorFor(d, b)
      }
      ctx.fill()
      ctx.globalAlpha = 1
      ctx.stroke()
    }
  }, [])

  // First paint, and repaint on resize or when the system theme changes.
  useEffect(() => {
    shown.current = visibleFor(root)
    boxes.current = new Map(shown.current.map((d) => [d, target(d, root)]))
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas) return
    const fit = () => {
      const w = wrap.clientWidth
      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(w * dpr)
      canvas.style.width = canvas.style.height = `${w}px`
      scaleRef.current = w / SIZE
      draw()
    }
    const ro = new ResizeObserver(fit)
    ro.observe(wrap)
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const redraw = () => requestAnimationFrame(draw)
    mq.addEventListener('change', redraw)
    fit()
    return () => {
      ro.disconnect()
      mq.removeEventListener('change', redraw)
    }
  }, [root, visibleFor, target, draw])

  const zoom = (d: Node) => {
    if (!d.children || d === focusRef.current) return
    const old = focusRef.current
    focusRef.current = d
    hoverRef.current = null
    setHover(null)
    setFocus(d)

    // Tween from what is on screen now to the new layout. Slices that only exist in one of
    // the two layouts slide in from (or out to) where they would sit in the other.
    const next = visibleFor(d)
    const all = new Set<Node>([...shown.current, ...next])
    const from = new Map<Node, Box>()
    const to = new Map<Node, Box>()
    for (const n of all) {
      from.set(n, boxes.current.get(n) ?? target(n, old))
      to.set(n, target(n, d))
    }
    shown.current = [...all]
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const t0 = performance.now()
    animating.current = true
    const tick = (now: number) => {
      if (focusRef.current !== d) return // a newer zoom took over
      const t = reduce ? 1 : Math.min(1, (now - t0) / TWEEN_MS)
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
      for (const n of all) {
        const a = from.get(n)!
        const b = to.get(n)!
        boxes.current.set(n, {
          x0: a.x0 + (b.x0 - a.x0) * e,
          x1: a.x1 + (b.x1 - a.x1) * e,
          y0: a.y0 + (b.y0 - a.y0) * e,
          y1: a.y1 + (b.y1 - a.y1) * e
        })
      }
      draw()
      if (t < 1) requestAnimationFrame(tick)
      else {
        shown.current = next
        boxes.current = new Map(next.map((n) => [n, to.get(n)!]))
        animating.current = false
      }
    }
    requestAnimationFrame(tick)
  }

  /** Which slice is under the pointer: polar coordinates against the current layout. */
  const hitTest = (e: React.MouseEvent<HTMLCanvasElement>): Node | null => {
    const r = e.currentTarget.getBoundingClientRect()
    const x = (e.clientX - r.left - r.width / 2) / scaleRef.current
    const y = (e.clientY - r.top - r.height / 2) / scaleRef.current
    const dist = Math.hypot(x, y)
    if (dist < HOLE) return null
    const ring = (dist - HOLE) / RING + 1
    let angle = Math.atan2(x, -y)
    if (angle < 0) angle += 2 * Math.PI
    for (const d of shown.current) {
      const b = boxes.current.get(d)
      if (b && ring >= b.y0 && ring < b.y1 && angle >= b.x0 && angle < b.x1) return d
    }
    return null
  }

  const onMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (animating.current) return
    const d = hitTest(e)
    e.currentTarget.style.cursor = d?.children ? 'pointer' : 'default'
    if (d !== hoverRef.current) {
      hoverRef.current = d
      draw()
    }
    const r = e.currentTarget.getBoundingClientRect()
    setHover(d ? { node: d, x: e.clientX - r.left, y: e.clientY - r.top } : null)
  }

  const crumbs = focus.ancestors().reverse()
  const kids = (focus.children ?? []).slice(0, 14)
  const detail = hover?.node ?? null
  const holePx = (HOLE - 4) * 2

  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
      <Card className="min-w-0">
        <CardContent>
          <div ref={wrapRef} className="relative mx-auto aspect-square w-full max-w-[560px]">
            <canvas
              ref={canvasRef}
              role="img"
              aria-label={`Storage map of ${pathOf(focus, result.sep)}`}
              className="block"
              onMouseMove={onMove}
              onMouseLeave={() => {
                hoverRef.current = null
                setHover(null)
                draw()
              }}
              onClick={(e) => {
                const d = hitTest(e)
                if (d) zoom(d)
              }}
            />
            <button
              type="button"
              disabled={!focus.parent}
              onClick={() => focus.parent && zoom(focus.parent)}
              className="bg-card border-border focus-visible:ring-ring absolute top-1/2 left-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-full border outline-none focus-visible:ring-2 enabled:cursor-pointer"
              style={{ width: `calc(${holePx} / ${SIZE} * 100%)`, height: `calc(${holePx} / ${SIZE} * 100%)` }}
              aria-label={focus.parent ? 'Go up one folder' : undefined}
            >
              <span className="text-[clamp(14px,3.2vw,22px)] leading-tight font-semibold tabular-nums">
                {formatBytes(focus.value ?? 0)}
              </span>
              <span className="text-muted-foreground max-w-[85%] truncate text-[11px]">
                {focus === root ? lastSegment(result.root, result.sep) : focus.data.n}
              </span>
              {focus.parent && <span className="text-primary text-[10px] font-medium">Click to go up</span>}
            </button>
            {hover && (
              <div
                className="bg-popover text-popover-foreground border-hairline pointer-events-none absolute z-20 w-max max-w-64 rounded-xl border px-3 py-2 text-xs shadow-lg"
                style={tooltipPosition(hover.x, hover.y, wrapRef.current?.clientWidth ?? 0)}
              >
                <p className="line-clamp-2 font-medium break-all">{hover.node.data.n}</p>
                <p className="text-muted-foreground tabular-nums">
                  {formatBytes(hover.node.value ?? 0)} ·{' '}
                  {formatPercent(((hover.node.value ?? 0) / (focus.value || 1)) * 100, 1)} of{' '}
                  {focus === root ? 'this scan' : focus.data.n}
                </p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="min-w-0">
        <CardHeader>
          <nav aria-label="Folder path" className="flex flex-wrap items-center gap-1 text-[13px]">
            {crumbs.map((c, i) => (
              <span key={i} className="flex min-w-0 items-center gap-1">
                {i > 0 && <ChevronRight className="text-muted-foreground size-3.5 shrink-0" />}
                <button
                  className={cn(
                    'hover:text-foreground focus-visible:ring-ring max-w-40 truncate rounded px-1 outline-none focus-visible:ring-2',
                    c === focus ? 'text-foreground font-semibold' : 'text-muted-foreground'
                  )}
                  onClick={() => c !== focus && zoom(c)}
                >
                  {i === 0 ? lastSegment(result.root, result.sep) : c.data.n}
                </button>
              </span>
            ))}
          </nav>
          <CardTitle className="pt-2 text-[28px] leading-tight font-semibold tracking-tight tabular-nums">
            {formatBytes(focus.value ?? 0)}
          </CardTitle>
          <CardDescription className="flex min-w-0 items-center justify-between gap-2">
            <span className="min-w-0 truncate" title={detail?.data.n}>
              {detail ? `Pointing at ${detail.data.n}` : 'Biggest items here'}
            </span>
            <span className="flex shrink-0 gap-1">
              {focus.parent && (
                <Button size="sm" variant="ghost" onClick={() => zoom(focus.parent!)}>
                  <CornerLeftUp /> Up
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => window.api.storage.reveal(pathOf(focus, result.sep))}>
                <FolderOpen /> Open
              </Button>
            </span>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-1">
            {kids.map((d) => {
              const pct = ((d.value ?? 0) / (focus.value || 1)) * 100
              return (
                <li key={d.data.n + d.depth}>
                  <div
                    className={cn(
                      'group hover:bg-muted/60 flex items-center gap-3 rounded-lg px-2 py-1.5',
                      detail === d && 'bg-muted/60'
                    )}
                  >
                    <span className="size-2.5 shrink-0 rounded-sm" style={{ background: colorFor(d, target(d, focus)) }} />
                    <button
                      className={cn(
                        'focus-visible:ring-ring min-w-0 flex-1 truncate rounded text-left text-sm outline-none focus-visible:ring-2',
                        d.children ? 'hover:underline' : 'cursor-default'
                      )}
                      title={d.data.n}
                      onClick={() => zoom(d)}
                      disabled={!d.children}
                    >
                      {d.data.n}
                      {d.data.k === 'd' && <span className="text-muted-foreground">/</span>}
                    </button>
                    <span className="text-muted-foreground w-12 text-right text-xs tabular-nums">{formatPercent(pct)}</span>
                    <span className="w-16 text-right text-sm font-medium tabular-nums">{formatBytes(d.value ?? 0)}</span>
                    {d.data.k !== 'r' && (
                      <button
                        className="text-muted-foreground hover:text-foreground focus-visible:ring-ring rounded p-1 opacity-0 outline-none group-hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2"
                        aria-label={`Show ${d.data.n} in folder`}
                        title="Show in folder"
                        onClick={() => window.api.storage.reveal(pathOf(d, result.sep))}
                      >
                        <FolderOpen className="size-3.5" />
                      </button>
                    )}
                  </div>
                </li>
              )
            })}
            {(focus.children?.length ?? 0) === 0 && (
              <li className="text-muted-foreground px-2 py-4 text-sm">Nothing big inside: every item here is under 1 MB.</li>
            )}
          </ul>
          <p className="text-muted-foreground mt-4 text-xs">
            Click a ring to zoom in. Items under 1 MB are grouped as “smaller items”.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

/** Keeps the tooltip inside the chart: it flips to the other side of the cursor near an edge. */
function tooltipPosition(x: number, y: number, size: number): React.CSSProperties {
  const gap = 16
  return {
    ...(x > size * 0.55 ? { right: size - x + gap } : { left: x + gap }),
    ...(y > size * 0.7 ? { bottom: size - y + gap } : { top: y + gap })
  }
}

function lastSegment(p: string, sep: string): string {
  const parts = p.split(sep).filter(Boolean)
  return parts.length ? parts[parts.length - 1] : p
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}
