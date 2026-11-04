import { useEffect, useMemo, useRef, useState } from 'react'
import { Bar, BarChart, LabelList, XAxis, YAxis } from 'recharts'
import { Boxes, CircleStop, Cpu, Loader2, MemoryStick } from 'lucide-react'
import { toast } from 'sonner'
import type { ProcInfo } from '../../../shared/types'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { formatBytes, formatPercent } from '@/lib/format'
import { LiveChart, LiveLegend, type Sample, type Series } from '@/components/LiveChart'
import { StatTile } from '@/features/Overview'

type SortKey = 'cpu' | 'mem'

const POLL_MS = 2000
const WINDOW_S = 60
/** Lines per chart. More than 4 lines become hard to tell apart. */
const TOP_N = 4
const SLOTS = ['--chart-1', '--chart-2', '--chart-3', '--chart-4']
const GB = 1024 ** 3

interface AppUsage {
  name: string
  cpu: number
  mem: number
  count: number
}

/** Browsers and editors run many processes — add them up per app name. */
function groupByApp(procs: ProcInfo[]): AppUsage[] {
  const map = new Map<string, AppUsage>()
  for (const p of procs) {
    const name = p.name.replace(/\.exe$/i, '')
    const e = map.get(name) ?? { name, cpu: 0, mem: 0, count: 0 }
    e.cpu += p.cpu
    e.mem += p.memBytes
    e.count++
    map.set(name, e)
  }
  return [...map.values()]
}

/**
 * Picks the top apps over the whole window (not just the latest sample, so lines
 * don't churn) and keeps each app's colour for as long as it stays in the chart.
 */
function pickSeries(history: Sample[], slots: Map<string, string>): Series[] {
  const totals = new Map<string, number>()
  for (const s of history) for (const [k, v] of Object.entries(s.values)) totals.set(k, (totals.get(k) ?? 0) + v)
  const top = [...totals].sort((a, b) => b[1] - a[1]).slice(0, TOP_N).map(([k]) => k)
  for (const k of [...slots.keys()]) if (!top.includes(k)) slots.delete(k)
  for (const k of top) {
    if (!slots.has(k)) slots.set(k, SLOTS.find((c) => ![...slots.values()].includes(c))!)
  }
  return top.map((k) => ({ key: k, label: k, colorVar: slots.get(k)! }))
}

const fmtPct = (v: number) => (Number.isInteger(v) ? `${v}%` : `${v.toFixed(1)}%`)
const fmtGb = (v: number) => (v === 0 ? '0' : formatBytes(v * GB))

export function Processes() {
  const [procs, setProcs] = useState<ProcInfo[] | null>(null)
  const [sort, setSort] = useState<SortKey>('cpu')
  const [target, setTarget] = useState<ProcInfo | null>(null)
  const cpuHistory = useRef<Sample[]>([])
  const memHistory = useRef<Sample[]>([])
  const polls = useRef(0)
  const cpuSlots = useRef(new Map<string, string>())
  const memSlots = useRef(new Map<string, string>())
  const [cpuSeries, setCpuSeries] = useState<Series[]>([])
  const [memSeries, setMemSeries] = useState<Series[]>([])

  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout>
    const record = (list: ProcInfo[]) => {
      const t = Date.now()
      const apps = groupByApp(list)
      const cutoff = t - (WINDOW_S + 5) * 1000
      // The first poll has no CPU baseline (everything reads 0%), so it isn't charted.
      const series = [[memHistory, (a: AppUsage) => a.mem / GB]] as [typeof cpuHistory, (a: AppUsage) => number][]
      if (polls.current++ > 0) series.push([cpuHistory, (a: AppUsage) => a.cpu])
      for (const [hist, pick] of series) {
        hist.current.push({ t, values: Object.fromEntries(apps.map((a) => [a.name, pick(a)])) })
        while (hist.current.length && hist.current[0].t < cutoff) hist.current.shift()
      }
      setCpuSeries(pickSeries(cpuHistory.current, cpuSlots.current))
      setMemSeries(pickSeries(memHistory.current, memSlots.current))
    }
    const load = async () => {
      try {
        const list = await window.api.getProcesses()
        if (!alive) return
        setProcs(list)
        record(list)
      } finally {
        if (alive) timer = setTimeout(load, POLL_MS)
      }
    }
    load()
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [])

  const sorted = useMemo(
    () => [...(procs ?? [])].sort((a, b) => (sort === 'cpu' ? b.cpu - a.cpu : b.memBytes - a.memBytes)).slice(0, 40),
    [procs, sort]
  )

  const apps = useMemo(() => groupByApp(procs ?? []), [procs])
  const busiest = apps.reduce<AppUsage | null>((a, b) => (!a || b.cpu > a.cpu ? b : a), null)
  const biggest = apps.reduce<AppUsage | null>((a, b) => (!a || b.mem > a.mem ? b : a), null)
  const collecting = cpuHistory.current.length < 2

  const end = async () => {
    if (!target) return
    const t = target
    setTarget(null)
    const res = await window.api.killProcess(t.pid)
    if (res.ok) {
      toast.success(`Asked ${t.name} to close`)
      setProcs((p) => p?.filter((x) => x.pid !== t.pid) ?? null)
    } else if (res.canForce) {
      // Windows background processes can't be asked politely — offer a forced end.
      toast.warning(`${t.name} can't be closed normally`, {
        description: `${res.error} Anything unsaved in it will be lost.`,
        duration: 10_000,
        action: {
          label: 'Force end',
          onClick: async () => {
            const forced = await window.api.killProcess(t.pid, true)
            if (forced.ok) {
              toast.success(`Ended ${t.name}`)
              setProcs((p) => p?.filter((x) => x.pid !== t.pid) ?? null)
            } else toast.error(`Couldn't end ${t.name}`, { description: forced.error })
          }
        }
      })
    } else toast.error(`Couldn't end ${t.name}`, { description: res.error })
  }

  return (
    <div className="grid gap-5">
      <div className="grid grid-cols-3 gap-5">
        <StatTile
          icon={Boxes}
          label="Running"
          value={procs ? `${procs.length}` : null}
          sub={procs ? `processes in ${apps.length} apps` : ''}
        />
        <StatTile
          icon={Cpu}
          label="Busiest app now"
          value={busiest ? formatPercent(busiest.cpu, 1) : null}
          sub={busiest ? `${busiest.name}${busiest.count > 1 ? ` (${busiest.count} processes)` : ''}` : ''}
        />
        <StatTile
          icon={MemoryStick}
          label="Largest app"
          value={biggest ? formatBytes(biggest.mem) : null}
          sub={biggest ? `${biggest.name}${biggest.count > 1 ? ` (${biggest.count} processes)` : ''}` : ''}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader className="space-y-3">
            <div className="space-y-1.5">
              <CardTitle>CPU by app</CardTitle>
              <CardDescription>Share of total CPU, top {TOP_N} apps over the last minute</CardDescription>
            </div>
            <LiveLegend series={cpuSeries} />
          </CardHeader>
          <CardContent className="relative">
            <LiveChart
              history={cpuHistory}
              series={cpuSeries}
              intervalMs={POLL_MS}
              missingAsZero
              yMinMax={5}
              formatY={fmtPct}
              ariaLabel="CPU use of the top apps over the last minute"
            />
            {collecting && <Collecting />}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="space-y-3">
            <div className="space-y-1.5">
              <CardTitle>Memory by app</CardTitle>
              <CardDescription>RAM held by the top {TOP_N} apps over the last minute</CardDescription>
            </div>
            <LiveLegend series={memSeries} />
          </CardHeader>
          <CardContent className="relative">
            <LiveChart
              history={memHistory}
              series={memSeries}
              intervalMs={POLL_MS}
              missingAsZero
              yMinMax={0.25}
              formatY={fmtGb}
              ariaLabel="Memory use of the top apps over the last minute"
            />
            {collecting && <Collecting />}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Biggest memory users</CardTitle>
          <CardDescription>Apps grouped by name — browsers and editors often run many processes</CardDescription>
        </CardHeader>
        <CardContent>{procs ? <MemoryByApp procs={procs} /> : <Skeleton className="h-56" />}</CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between">
          <div className="space-y-1.5">
            <CardTitle>Running processes</CardTitle>
            <CardDescription>Refreshed every 2 seconds. Ending a heavy app frees its CPU and memory.</CardDescription>
          </div>
          <Tabs value={sort} onValueChange={(v) => setSort(v as SortKey)}>
            <TabsList>
              <TabsTrigger value="cpu">By CPU</TabsTrigger>
              <TabsTrigger value="mem">By memory</TabsTrigger>
            </TabsList>
          </Tabs>
        </CardHeader>
        <CardContent>
          {!procs ? (
            <Skeleton className="h-96" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead className="w-20 text-right">PID</TableHead>
                  <TableHead className="w-24 text-right">CPU</TableHead>
                  <TableHead className="w-28 text-right">Memory</TableHead>
                  <TableHead className="w-28">User</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((p) => (
                  <TableRow key={p.pid}>
                    <TableCell className="max-w-0">
                      <p className="truncate font-medium">{p.name}</p>
                      <p className="text-muted-foreground truncate text-xs" title={p.command}>
                        {p.command}
                      </p>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-right tabular-nums">{p.pid}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatPercent(p.cpu, 1)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatBytes(p.memBytes)}</TableCell>
                    <TableCell className="text-muted-foreground truncate">{p.user}</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="ghost" onClick={() => setTarget(p)}>
                        <CircleStop /> End
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {procs && procs.length === 0 && (
            <p className="text-muted-foreground flex items-center gap-2 text-sm">
              <Loader2 className="size-4 animate-spin" /> Loading…
            </p>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={!!target} onOpenChange={(o) => !o && setTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>End “{target?.name}”?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm">
                <div>
                  <p className="text-success text-xs font-semibold tracking-wide uppercase">You gain</p>
                  <p className="text-foreground">
                    About {formatBytes(target?.memBytes ?? 0)} of memory and {formatPercent(target?.cpu ?? 0, 1)} CPU
                    back for other apps.
                  </p>
                </div>
                <div>
                  <p className="text-destructive text-xs font-semibold tracking-wide uppercase">You might lose</p>
                  <ul className="text-foreground list-disc space-y-1 pl-5">
                    <li>Any unsaved work in this app — save first if it's a document, editor or form.</li>
                    <li>If it is a background service, the feature it provides (sync, sound, network…) may stop until you restart it or the PC.</li>
                    <li>If it's one tab or helper of a browser, that tab may crash and need reloading.</li>
                  </ul>
                </div>
                <p>The app is asked to close normally, the same as clicking its close button.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep running</AlertDialogCancel>
            <AlertDialogAction onClick={end} variant="destructive">
              End process
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

const memConfig = { bytes: { label: 'Memory', color: 'var(--chart-2)' } } satisfies ChartConfig

function Collecting() {
  return (
    <p className="text-muted-foreground pointer-events-none absolute inset-0 flex items-center justify-center gap-2 text-sm">
      <Loader2 className="size-4 animate-spin" /> Collecting samples…
    </p>
  )
}

function MemoryByApp({ procs }: { procs: ProcInfo[] }) {
  const data = useMemo(
    () =>
      groupByApp(procs)
        .sort((a, b) => b.mem - a.mem)
        .slice(0, 8)
        .map((a) => ({ name: a.count > 1 ? `${a.name} (${a.count})` : a.name, bytes: a.mem })),
    [procs]
  )

  return (
    <ChartContainer config={memConfig} className="aspect-auto h-64 w-full">
      <BarChart data={data} layout="vertical" margin={{ left: 0, right: 72 }} barCategoryGap={4}>
        <YAxis dataKey="name" type="category" tickLine={false} axisLine={false} width={160} />
        <XAxis type="number" dataKey="bytes" hide />
        <ChartTooltip
          cursor={{ fill: 'var(--muted)', opacity: 0.5 }}
          content={<ChartTooltipContent formatter={(v) => <span className="font-medium tabular-nums">{formatBytes(Number(v))}</span>} />}
        />
        <Bar dataKey="bytes" fill="var(--color-bytes)" radius={4} isAnimationActive={false}>
          <LabelList dataKey="bytes" position="right" className="fill-foreground" fontSize={12} formatter={(v) => formatBytes(Number(v))} />
        </Bar>
      </BarChart>
    </ChartContainer>
  )
}
