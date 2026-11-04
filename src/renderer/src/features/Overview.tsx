import { useEffect, useMemo, useState, type RefObject } from 'react'
import { Cpu, HardDrive, Info, MemoryStick, Timer } from 'lucide-react'
import { Label, Pie, PieChart } from 'recharts'
import type { DiskInfo, Snapshot, StaticInfo } from '../../../shared/types'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { LiveChart, LiveLegend, type Sample, type Series } from '@/components/LiveChart'
import { formatBytes, formatPercent, formatUptime } from '@/lib/format'

const LIVE_SERIES: Series[] = [
  { key: 'cpu', label: 'CPU', colorVar: '--chart-1' },
  { key: 'mem', label: 'Memory', colorVar: '--chart-2' }
]

interface Props {
  info: StaticInfo | null
  latest: Snapshot | null
  history: RefObject<Sample[]>
}

export function Overview({ info, latest, history }: Props) {
  const [disks, setDisks] = useState<DiskInfo[] | null>(null)

  useEffect(() => {
    const load = () => window.api.getDisks().then(setDisks)
    load()
    const t = setInterval(load, 30_000)
    return () => clearInterval(t)
  }, [])

  const mainDisk = disks?.find((d) => d.mount === '/' || /^c:/i.test(d.mount)) ?? disks?.[0]
  const mem = latest?.mem

  return (
    <div className="grid gap-5">
      <div className="grid grid-cols-2 gap-5 lg:grid-cols-4">
        <StatTile
          icon={Cpu}
          label="CPU load"
          value={latest ? formatPercent(latest.cpu) : null}
          sub={info ? `${info.logicalCores} threads · ${info.cpuModel}` : ''}
        />
        <StatTile
          icon={MemoryStick}
          label="Memory in use"
          value={mem ? formatBytes(mem.used) : null}
          sub={mem ? `of ${formatBytes(mem.total)} (${formatPercent((mem.used / mem.total) * 100)})` : ''}
        />
        <StatTile
          icon={HardDrive}
          label="Disk used"
          value={mainDisk ? formatPercent((mainDisk.used / mainDisk.size) * 100) : null}
          sub={mainDisk ? `${formatBytes(mainDisk.size - mainDisk.used)} free on ${mainDisk.mount}` : ''}
        />
        <StatTile
          icon={Timer}
          label="Uptime"
          value={latest ? formatUptime(latest.uptime) : null}
          sub={info ? `${info.osName} · ${info.hostname}` : ''}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-start justify-between">
            <div className="space-y-1.5">
              <CardTitle>Live usage</CardTitle>
              <CardDescription>Last 60 seconds, updated every second</CardDescription>
            </div>
            <LiveLegend series={LIVE_SERIES} />
          </CardHeader>
          <CardContent>
            <LiveChart
              history={history}
              series={LIVE_SERIES}
              yMax={100}
              formatY={(v) => `${Math.round(v)}%`}
              fill
              ariaLabel="Live CPU and memory usage over the last 60 seconds"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>CPU cores</CardTitle>
            <CardDescription>Load on each thread, last 60 seconds</CardDescription>
          </CardHeader>
          <CardContent>
            {latest ? <CoreGraphs cores={latest.cores} history={history} /> : <Skeleton className="h-[220px]" />}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Where your memory goes</CardTitle>
            <CardDescription>What is actually using RAM, and what only looks like it</CardDescription>
          </CardHeader>
          <CardContent>{mem ? <MemoryBreakdown mem={mem} /> : <Skeleton className="h-28" />}</CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Storage</CardTitle>
            <CardDescription>Space on your drives</CardDescription>
          </CardHeader>
          <CardContent>{disks ? <Disks disks={disks} main={mainDisk} /> : <Skeleton className="h-48" />}</CardContent>
        </Card>
      </div>
    </div>
  )
}

export function StatTile(props: { icon: typeof Cpu; label: string; value: string | null; sub: string }) {
  const Icon = props.icon
  return (
    <Card className="gap-2 py-4">
      <CardHeader className="px-4">
        <CardDescription className="flex items-center gap-2">
          <Icon className="size-4" />
          {props.label}
        </CardDescription>
      </CardHeader>
      <CardContent className="px-4">
        {props.value === null ? (
          <Skeleton className="h-8 w-24" />
        ) : (
          <div className="text-[28px] leading-tight font-semibold tracking-tight tabular-nums">{props.value}</div>
        )}
        <p className="text-muted-foreground mt-1 truncate text-xs" title={props.sub}>
          {props.sub}
        </p>
      </CardContent>
    </Card>
  )
}

/** Small multiples: one live sparkline per thread, all on the same 0–100% scale. */
function CoreGraphs({ cores, history }: { cores: number[]; history: RefObject<Sample[]> }) {
  const cols = cores.length <= 8 ? 2 : 4
  const rows = Math.ceil(cores.length / cols)
  // Fill the same height as the live usage chart next to it.
  const chartHeight = Math.max(22, Math.floor((236 - rows * 22) / rows))
  const series = useMemo(
    () => cores.map((_, i): Series => ({ key: `core${i}`, label: `Thread ${i + 1}`, colorVar: '--chart-1' })),
    [cores.length] // eslint-disable-line react-hooks/exhaustive-deps
  )
  return (
    <div className="grid gap-x-4 gap-y-1.5" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
      {series.map((s, i) => (
        <div key={s.key}>
          <div className="flex items-baseline justify-between text-xs">
            <span className="text-muted-foreground">{s.label}</span>
            <span className="font-medium tabular-nums">{formatPercent(cores[i])}</span>
          </div>
          <div className="bg-muted/40 rounded-[4px]">
            <LiveChart
              history={history}
              series={[s]}
              height={chartHeight}
              yMax={100}
              formatY={(v) => formatPercent(v)}
              fill
              compact
              ariaLabel={`${s.label} load over the last 60 seconds`}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

function MemoryBreakdown({ mem }: { mem: Snapshot['mem'] }) {
  const free = Math.max(0, mem.total - mem.used - mem.cache)
  const parts = [
    { label: 'Used by apps', bytes: mem.used, color: 'var(--chart-2)' },
    { label: 'File cache (auto-freed)', bytes: Math.min(mem.cache, mem.total - mem.used), color: 'var(--chart-4)' },
    { label: 'Free', bytes: free, color: 'var(--muted)' }
  ]
  const swapPct = mem.swapTotal ? (mem.swapUsed / mem.swapTotal) * 100 : 0
  return (
    <div className="space-y-4">
      <div className="flex h-4 w-full gap-[2px] overflow-hidden rounded-[4px]">
        {parts.map((p) => (
          <div
            key={p.label}
            title={`${p.label}: ${formatBytes(p.bytes)}`}
            className="h-full transition-[width] duration-700"
            style={{ width: `${(p.bytes / mem.total) * 100}%`, background: p.color }}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
        {parts.map((p) => (
          <span key={p.label} className="flex items-center gap-2">
            <span className="size-2.5 rounded-sm" style={{ background: p.color }} />
            <span className="text-muted-foreground">{p.label}</span>
            <span className="font-medium tabular-nums">{formatBytes(p.bytes)}</span>
          </span>
        ))}
        {mem.swapTotal > 0 && (
          <span className="text-muted-foreground">
            Swap <span className="text-foreground font-medium tabular-nums">{formatBytes(mem.swapUsed)}</span> (
            {formatPercent(swapPct)})
          </span>
        )}
      </div>
      <div className="bg-muted/50 text-muted-foreground flex gap-2 rounded-md p-3 text-sm">
        <Info className="mt-0.5 size-4 shrink-0" />
        <p>
          <span className="text-foreground font-medium">File cache is not wasted memory.</span> Your system keeps
          recently used files in spare RAM so they open instantly, and hands that memory to apps the moment they need
          it. Clearing it would only make things slower. If <em>Used by apps</em> is near the total, or swap use keeps
          growing, close heavy apps from the Processes tab.
        </p>
      </div>
    </div>
  )
}

const diskConfig = {
  used: { label: 'Used', color: 'var(--chart-1)' },
  free: { label: 'Free', color: 'var(--muted)' }
} satisfies ChartConfig

function Disks({ disks, main }: { disks: DiskInfo[]; main?: DiskInfo }) {
  if (!main) return <p className="text-muted-foreground text-sm">No drives found.</p>
  const pct = (main.used / main.size) * 100
  const data = [
    { key: 'used', value: main.used, fill: 'var(--color-used)' },
    { key: 'free', value: main.size - main.used, fill: 'var(--color-free)' }
  ]
  const others = disks.filter((d) => d !== main)
  return (
    <div className="space-y-4">
      <ChartContainer config={diskConfig} className="mx-auto aspect-square max-h-[180px]">
        <PieChart>
          <ChartTooltip
            cursor={false}
            content={
              <ChartTooltipContent
                hideLabel
                nameKey="key"
                formatter={(v, name) => (
                  <div className="flex w-full justify-between gap-4">
                    <span className="text-muted-foreground">{diskConfig[name as 'used' | 'free'].label}</span>
                    <span className="font-medium tabular-nums">{formatBytes(Number(v))}</span>
                  </div>
                )}
              />
            }
          />
          <Pie data={data} dataKey="value" nameKey="key" innerRadius={58} outerRadius={78} strokeWidth={2} stroke="var(--card)" startAngle={90} endAngle={-270}>
            <Label
              content={({ viewBox }) =>
                viewBox && 'cx' in viewBox ? (
                  <text x={viewBox.cx} y={viewBox.cy} textAnchor="middle" dominantBaseline="middle">
                    <tspan x={viewBox.cx} y={viewBox.cy} className="fill-foreground text-2xl font-semibold">
                      {formatPercent(pct)}
                    </tspan>
                    <tspan x={viewBox.cx} y={(viewBox.cy ?? 0) + 22} className="fill-muted-foreground text-xs">
                      used of {formatBytes(main.size, 0)}
                    </tspan>
                  </text>
                ) : null
              }
            />
          </Pie>
        </PieChart>
      </ChartContainer>
      <p className="text-muted-foreground text-center text-xs">
        {main.mount} · {main.type}
        {pct > 90 && <span className="text-destructive block">Almost full — a nearly full drive slows everything down.</span>}
      </p>
      {others.map((d) => (
        <div key={d.fs} className="space-y-1">
          <div className="flex justify-between text-xs">
            <span className="truncate" title={d.mount}>
              {d.mount}
            </span>
            <span className="text-muted-foreground tabular-nums">
              {formatBytes(d.used)} / {formatBytes(d.size)}
            </span>
          </div>
          <Progress value={(d.used / d.size) * 100} className="h-1.5" />
        </div>
      ))}
    </div>
  )
}
