import { useEffect, useRef, useState, type RefObject } from 'react'
import { scaleLinear } from 'd3-scale'
import { area, curveMonotoneX, line } from 'd3-shape'

/** One reading in time. Missing keys are gaps unless `missingAsZero` is set. */
export interface Sample {
  t: number
  values: Record<string, number>
}

export interface Series {
  key: string
  label: string
  /** CSS variable holding the colour, e.g. "--chart-1" */
  colorVar: string
}

interface Props {
  history: RefObject<Sample[]>
  series: Series[]
  height?: number
  windowSeconds?: number
  /** How often samples arrive; the chart lags by this much so new points slide in. */
  intervalMs?: number
  /** Fixed top of the y axis (e.g. 100 for percentages). Omit to fit the data. */
  yMax?: number
  /** Smallest top of the y axis when fitting to data. */
  yMinMax?: number
  formatY: (v: number) => string
  /** Shade the area under each line. Best for 1–2 series. */
  fill?: boolean
  /** Sparkline mode for small multiples: no axis labels, one midline. */
  compact?: boolean
  /** Treat a key missing from a sample as 0 (e.g. an app that wasn't running) instead of a gap. */
  missingAsZero?: boolean
  ariaLabel: string
}

const FULL_PAD = { top: 8, right: 8, bottom: 20, left: 52 }
const COMPACT_PAD = { top: 3, right: 1, bottom: 1, left: 1 }

const value = (d: Sample, key: string) => d.values[key] ?? 0
const has = (d: Sample, key: string) => d.values[key] !== undefined

/**
 * Real-time line chart drawn with D3 path generators onto a <canvas>.
 * Redraws on requestAnimationFrame so lines glide smoothly between samples,
 * React never re-renders per frame, and drawing pauses while the window is hidden.
 */
export function LiveChart({
  history,
  series,
  height = 220,
  windowSeconds = 60,
  intervalMs = 1000,
  yMax,
  yMinMax = 1,
  formatY,
  fill = false,
  compact = false,
  missingAsZero = false,
  ariaLabel
}: Props) {
  const PAD = compact ? COMPACT_PAD : FULL_PAD
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const hoverX = useRef<number | null>(null)
  const [tip, setTip] = useState<{ x: number; s: Sample } | null>(null)

  // Keep the latest props in refs so the draw loop never restarts.
  const seriesRef = useRef(series)
  seriesRef.current = series
  const formatRef = useRef(formatY)
  formatRef.current = formatY

  const xScale = (width: number) => {
    const now = Date.now() - intervalMs
    return scaleLinear()
      .domain([now - windowSeconds * 1000, now])
      .range([PAD.left, width - PAD.right])
  }

  const nearest = (data: Sample[], t: number) => {
    let best = data[0]
    for (const d of data) if (Math.abs(d.t - t) < Math.abs(best.t - t)) best = d
    return best
  }

  useEffect(() => {
    const canvas = canvasRef.current!
    const wrap = wrapRef.current!
    const ctx = canvas.getContext('2d')!
    let width = 0
    let raf = 0
    let ink = { grid: '', label: '', cross: '', card: '' }
    const colorCache = new Map<string, string>()
    const color = (v: string) => {
      if (!colorCache.has(v)) colorCache.set(v, getComputedStyle(wrap).getPropertyValue(v).trim())
      return colorCache.get(v)!
    }

    const readColors = () => {
      colorCache.clear()
      const cs = getComputedStyle(wrap)
      ink = {
        grid: cs.getPropertyValue('--border').trim(),
        label: cs.getPropertyValue('--muted-foreground').trim(),
        cross: cs.getPropertyValue('--foreground').trim(),
        card: cs.getPropertyValue('--card').trim()
      }
    }

    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      width = wrap.clientWidth
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    // The y axis eases toward its target so rescaling doesn't jump.
    let shownMax = yMax ?? yMinMax

    const draw = () => {
      raf = requestAnimationFrame(draw)
      if (document.hidden || !width) return
      const data = history.current
      const list = seriesRef.current
      const fmt = formatRef.current
      const x = xScale(width)

      let target = yMax
      if (target === undefined) {
        let m = yMinMax
        for (const d of data) for (const s of list) m = Math.max(m, value(d, s.key))
        target = scaleLinear().domain([0, m * 1.1]).nice(4).domain()[1]
      }
      shownMax += (target - shownMax) * 0.12
      const y = scaleLinear().domain([0, shownMax]).range([height - PAD.bottom, PAD.top])

      ctx.clearRect(0, 0, width, height)

      // recessive grid + axis labels
      ctx.font = '11px system-ui, sans-serif'
      ctx.lineWidth = 1
      ctx.textAlign = 'right'
      ctx.textBaseline = 'middle'
      for (const v of compact ? [0, shownMax / 2] : y.ticks(4)) {
        const yy = Math.round(y(v)) + 0.5
        ctx.strokeStyle = ink.grid
        ctx.beginPath()
        ctx.moveTo(PAD.left, yy)
        ctx.lineTo(width - PAD.right, yy)
        ctx.stroke()
        if (compact) continue
        ctx.fillStyle = ink.label
        ctx.fillText(fmt(v), PAD.left - 6, yy)
      }
      if (!compact) {
        ctx.textAlign = 'center'
        ctx.textBaseline = 'top'
        const now = x.domain()[1]
        for (let s = windowSeconds; s >= 0; s -= windowSeconds / 4) {
          ctx.fillText(s === 0 ? 'now' : `${s}s`, x(now - s * 1000), height - PAD.bottom + 6)
        }
      }

      ctx.save()
      ctx.beginPath()
      ctx.rect(PAD.left, 0, width - PAD.left - PAD.right, height)
      ctx.clip()
      for (const s of list) {
        const c = color(s.colorVar)
        if (fill) {
          const a = area<Sample>()
            .defined((d) => missingAsZero || has(d, s.key))
            .x((d) => x(d.t))
            .y0(y(0))
            .y1((d) => y(value(d, s.key)))
            .curve(curveMonotoneX)
            .context(ctx)
          ctx.beginPath()
          a(data)
          ctx.globalAlpha = 0.12
          ctx.fillStyle = c
          ctx.fill()
          ctx.globalAlpha = 1
        }
        const l = line<Sample>()
          .defined((d) => missingAsZero || has(d, s.key))
          .x((d) => x(d.t))
          .y((d) => y(value(d, s.key)))
          .curve(curveMonotoneX)
          .context(ctx)
        ctx.beginPath()
        l(data)
        ctx.lineWidth = compact ? 1.5 : 2
        ctx.lineJoin = 'round'
        ctx.strokeStyle = c
        ctx.stroke()
      }
      ctx.restore()

      // crosshair + markers
      const hx = hoverX.current
      if (hx !== null && data.length) {
        const n = nearest(data, x.invert(hx))
        const nx = x(n.t)
        ctx.strokeStyle = ink.cross
        ctx.globalAlpha = 0.35
        ctx.beginPath()
        ctx.moveTo(nx, PAD.top)
        ctx.lineTo(nx, height - PAD.bottom)
        ctx.stroke()
        ctx.globalAlpha = 1
        for (const s of list) {
          if (!missingAsZero && !has(n, s.key)) continue
          ctx.beginPath()
          ctx.arc(nx, y(value(n, s.key)), compact ? 3 : 4, 0, Math.PI * 2)
          ctx.fillStyle = color(s.colorVar)
          ctx.fill()
          ctx.lineWidth = 2
          ctx.strokeStyle = ink.card
          ctx.stroke()
        }
      }
    }

    readColors()
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(wrap)
    const mo = new MutationObserver(readColors)
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    raf = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      mo.disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history, height, windowSeconds, intervalMs, yMax, yMinMax, fill, compact, missingAsZero])

  const onMove = (e: React.PointerEvent) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const px = e.clientX - rect.left
    const data = history.current
    if (px < PAD.left || !data.length) return onLeave()
    hoverX.current = px
    setTip({ x: px, s: nearest(data, xScale(rect.width).invert(px)) })
  }
  const onLeave = () => {
    hoverX.current = null
    setTip(null)
  }

  const tipWidth = compact ? 120 : 190
  return (
    <div ref={wrapRef} className="relative w-full" style={{ height }} onPointerMove={onMove} onPointerLeave={onLeave}>
      <canvas ref={canvasRef} role="img" aria-label={ariaLabel} />
      {tip && (
        <div
          className={`bg-popover text-popover-foreground pointer-events-none absolute z-20 rounded-md border px-2.5 py-1.5 text-xs shadow-md ${compact ? 'bottom-full mb-1' : 'top-2'}`}
          style={{ left: tip.x > tipWidth + 24 ? tip.x - tipWidth - 12 : tip.x + 12, width: tipWidth }}
        >
          <div className="text-muted-foreground mb-0.5">{Math.max(0, Math.round((Date.now() - tip.s.t) / 1000))}s ago</div>
          {series.map((s) => (
            <div key={s.key} className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="size-2 shrink-0 rounded-full" style={{ background: `var(${s.colorVar})` }} />
                <span className="truncate">{s.label}</span>
              </span>
              <span className="font-medium tabular-nums">
                {missingAsZero || has(tip.s, s.key) ? formatY(value(tip.s, s.key)) : '—'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** Small legend matching the chart's line colours. */
export function LiveLegend({ series }: { series: Series[] }) {
  return (
    <div className="flex flex-wrap justify-end gap-x-4 gap-y-1 text-sm">
      {series.map((s) => (
        <span key={s.key} className="text-muted-foreground flex max-w-40 items-center gap-1.5">
          <span className="h-0.5 w-3 shrink-0 rounded-full" style={{ background: `var(${s.colorVar})` }} />
          <span className="truncate">{s.label}</span>
        </span>
      ))}
    </div>
  )
}
