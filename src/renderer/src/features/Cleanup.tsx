import { useEffect, useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, LabelList, XAxis, YAxis } from 'recharts'
import {
  ChevronRight,
  Copy,
  FolderOpen,
  Lightbulb,
  Loader2,
  ScanSearch,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  UserLock
} from 'lucide-react'
import { toast } from 'sonner'
import type { Category, CleanResult, Risk, ScanProgress, ScanResult } from '../../../shared/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart'
import { Checkbox } from '@/components/ui/checkbox'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Progress } from '@/components/ui/progress'
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
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { formatBytes } from '@/lib/format'

const CATEGORY_LABEL: Record<Category, string> = {
  browser: 'Browsers',
  apps: 'Apps',
  developer: 'Developer tools',
  system: 'System',
  temp: 'Temp files',
  trash: 'Trash'
}

const RISK: Record<Risk, { label: string; icon: typeof ShieldCheck; className: string; hint: string }> = {
  safe: {
    label: 'Safe',
    icon: ShieldCheck,
    className: 'text-success bg-success/12 border-transparent',
    hint: 'Everything here is rebuilt automatically. You will not notice anything.'
  },
  low: {
    label: 'Minor side effects',
    icon: ShieldAlert,
    className: 'text-warning bg-warning/12 border-transparent',
    hint: 'Rebuilt automatically, but something may be slower or re-download once.'
  },
  medium: {
    label: 'Think first',
    icon: TriangleAlert,
    className: 'text-destructive bg-destructive/10 border-transparent',
    hint: 'Something is removed for good or is expensive to get back. Not selected by default.'
  }
}

/** Tiny items aren't pre-selected — not worth any side effect. */
const MIN_PRESELECT = 1024 * 1024

type Phase = 'idle' | 'scanning' | 'ready' | 'cleaning'

/** `active` is false while the tab is hidden; charts can't measure a hidden container. */
export function Cleanup({ active }: { active: boolean }) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [progress, setProgress] = useState<ScanProgress | null>(null)
  const [results, setResults] = useState<ScanResult[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [lastClean, setLastClean] = useState<{ freed: number; skipped: number; files: number } | null>(null)

  useEffect(() => window.api.onScanProgress(setProgress), [])

  const scan = async (keepSelection = false) => {
    setPhase('scanning')
    setProgress(null)
    try {
      const res = (await window.api.scan()).sort((a, b) => b.bytes - a.bytes)
      setResults(res)
      if (!keepSelection) {
        setSelected(
          new Set(res.filter((r) => !r.manualCommand && r.risk === 'safe' && r.bytes >= MIN_PRESELECT).map((r) => r.id))
        )
      } else {
        setSelected((s) => new Set(res.filter((r) => s.has(r.id) && r.bytes > 0).map((r) => r.id)))
      }
      setPhase('ready')
    } catch (e) {
      toast.error('Scan failed', { description: String(e) })
      setPhase(results.length ? 'ready' : 'idle')
    }
  }

  const clean = async () => {
    setConfirmOpen(false)
    setPhase('cleaning')
    setProgress(null)
    try {
      const res: CleanResult[] = await window.api.clean([...selected])
      const freed = res.reduce((a, r) => a + r.freedBytes, 0)
      const skipped = res.reduce((a, r) => a + r.skipped, 0)
      const files = res.reduce((a, r) => a + r.deletedFiles, 0)
      setLastClean({ freed, skipped, files })
      toast.success(`Freed ${formatBytes(freed)}`, { description: `${files.toLocaleString()} files removed` })
    } catch (e) {
      toast.error('Cleaning failed', { description: String(e) })
    }
    await scan(true)
  }

  const cleanable = results.filter((r) => !r.manualCommand)
  const manual = results.filter((r) => r.manualCommand && r.bytes > 0)
  const totalCleanable = cleanable.reduce((a, r) => a + r.bytes, 0)
  const totalManual = manual.reduce((a, r) => a + r.bytes, 0)
  const chosen = cleanable.filter((r) => selected.has(r.id))
  const selectedBytes = chosen.reduce((a, r) => a + r.bytes, 0)

  const toggle = (id: string, on: boolean) =>
    setSelected((s) => {
      const n = new Set(s)
      if (on) n.add(id)
      else n.delete(id)
      return n
    })

  const busy = phase === 'scanning' || phase === 'cleaning'

  return (
    <div className="grid gap-5 pb-20">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div className="space-y-1.5">
            <CardTitle>Find what's taking up space</CardTitle>
            <CardDescription>
              Caches, temp files and leftovers that fill your drive. Nothing is deleted until you review it and confirm.
            </CardDescription>
          </div>
          <Button onClick={() => scan()} disabled={busy} variant={phase === 'idle' ? 'default' : 'outline'}>
            {phase === 'scanning' ? <Loader2 className="animate-spin" /> : <ScanSearch />}
            {phase === 'idle' ? 'Scan now' : 'Scan again'}
          </Button>
        </CardHeader>
        <CardContent>
          {busy && (
            <div className="space-y-2">
              <Progress value={progress ? (progress.done / progress.total) * 100 : 5} />
              <p className="text-muted-foreground text-sm">
                {phase === 'cleaning' ? 'Cleaning' : 'Looking at'} {progress?.current || '…'}
              </p>
            </div>
          )}

          {phase === 'idle' && (
            <div className="grid gap-3 sm:grid-cols-3">
              {(['safe', 'low', 'medium'] as Risk[]).map((r) => (
                <RiskExplainer key={r} risk={r} />
              ))}
            </div>
          )}

          {phase === 'ready' && results.length > 0 && (
            <div className="grid gap-6 md:grid-cols-[220px_1fr]">
              <div className="space-y-1">
                <p className="text-muted-foreground text-sm">Can be freed here</p>
                <p className="text-5xl font-semibold tracking-tight tabular-nums">{formatBytes(totalCleanable)}</p>
                {totalManual > 0 && (
                  <p className="text-muted-foreground text-xs">+ {formatBytes(totalManual)} more with admin rights</p>
                )}
                {lastClean && (
                  <div className="bg-success/10 mt-3 rounded-md p-2.5 text-sm">
                    <p className="text-success flex items-center gap-1.5 font-medium">
                      <Sparkles className="size-4" /> Freed {formatBytes(lastClean.freed)}
                    </p>
                    {lastClean.skipped > 0 && (
                      <p className="text-muted-foreground mt-1 text-xs">
                        {lastClean.skipped.toLocaleString()} files were in use or protected and were left alone. Close
                        the related apps and clean again to remove them.
                      </p>
                    )}
                  </div>
                )}
              </div>
              {active && <CategoryChart results={results} />}
            </div>
          )}
        </CardContent>
      </Card>

      {results.length > 0 && (
        <Card className="gap-0 py-0">
          <div className="divide-y">
            {cleanable.map((r) => (
              <TargetRow
                key={r.id}
                r={r}
                checked={selected.has(r.id)}
                disabled={busy || r.bytes === 0}
                onCheck={(on) => toggle(r.id, on)}
              />
            ))}
            {manual.map((r) => (
              <TargetRow key={r.id} r={r} checked={false} disabled onCheck={() => {}} />
            ))}
          </div>
        </Card>
      )}

      {phase !== 'idle' && results.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-hairline bg-background/70 backdrop-blur-xl backdrop-saturate-150">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-3">
            <p className="text-sm">
              <span className="font-medium">{chosen.length} selected</span>
              <span className="text-muted-foreground"> · </span>
              <span className="font-semibold tabular-nums">{formatBytes(selectedBytes)}</span>
            </p>
            <Button disabled={busy || chosen.length === 0} onClick={() => setConfirmOpen(true)}>
              {phase === 'cleaning' ? <Loader2 className="animate-spin" /> : <Sparkles />}
              Review & clean
            </Button>
          </div>
        </div>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent className="sm:max-w-xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Free up {formatBytes(selectedBytes)}?</AlertDialogTitle>
            <AlertDialogDescription>
              Here is what you will notice afterwards.
              {chosen.some((r) => r.risk === 'medium') && ' Please read the items in red carefully — they cannot be undone.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ScrollArea className="max-h-[50vh] pr-3">
            <ul className="space-y-3">
              {chosen.map((r) => {
                const risk = RISK[r.risk]
                return (
                  <li key={r.id} className="text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 font-medium">
                        <risk.icon className={cn('size-4', risk.className)} />
                        {r.name}
                      </span>
                      <span className="text-muted-foreground tabular-nums">{formatBytes(r.bytes)}</span>
                    </div>
                    <p className={cn('mt-0.5 pl-5.5', r.risk === 'medium' ? 'text-destructive' : 'text-muted-foreground')}>
                      {r.loss}
                    </p>
                    {r.tip && <p className="text-muted-foreground mt-0.5 pl-5.5 italic">{r.tip}</p>}
                  </li>
                )
              })}
            </ul>
          </ScrollArea>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={clean}>Clean {chosen.length} items</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function RiskExplainer({ risk }: { risk: Risk }) {
  const r = RISK[risk]
  return (
    <div className="rounded-md border p-3">
      <Badge variant="outline" className={r.className}>
        <r.icon /> {r.label}
      </Badge>
      <p className="text-muted-foreground mt-2 text-sm">{r.hint}</p>
    </div>
  )
}

const categoryConfig = { bytes: { label: 'Space', color: 'var(--chart-1)' } } satisfies ChartConfig

function CategoryChart({ results }: { results: ScanResult[] }) {
  const data = useMemo(() => {
    const totals = new Map<Category, number>()
    for (const r of results) if (!r.manualCommand) totals.set(r.category, (totals.get(r.category) ?? 0) + r.bytes)
    return [...totals]
      .filter(([, b]) => b > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([c, bytes]) => ({ category: CATEGORY_LABEL[c], bytes }))
  }, [results])

  return (
    <ChartContainer config={categoryConfig} className="aspect-auto w-full" style={{ height: Math.max(120, data.length * 34) }}>
      <BarChart data={data} layout="vertical" margin={{ left: 0, right: 64 }} barCategoryGap={4}>
        <CartesianGrid horizontal={false} strokeDasharray="0" />
        <YAxis dataKey="category" type="category" tickLine={false} axisLine={false} width={120} />
        <XAxis type="number" dataKey="bytes" hide />
        <ChartTooltip
          cursor={{ fill: 'var(--muted)', opacity: 0.5 }}
          content={<ChartTooltipContent formatter={(v) => <span className="font-medium tabular-nums">{formatBytes(Number(v))}</span>} />}
        />
        <Bar dataKey="bytes" fill="var(--color-bytes)" radius={4} isAnimationActive={false}>
          <LabelList
            dataKey="bytes"
            position="right"
            className="fill-foreground"
            fontSize={12}
            formatter={(v) => formatBytes(Number(v))}
          />
        </Bar>
      </BarChart>
    </ChartContainer>
  )
}

function TargetRow(props: { r: ScanResult; checked: boolean; disabled: boolean; onCheck: (on: boolean) => void }) {
  const { r } = props
  const risk = RISK[r.risk]
  const [open, setOpen] = useState(false)
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="flex items-center gap-3 px-4 py-3">
        {r.manualCommand ? (
          <UserLock className="text-muted-foreground size-4" aria-label="Needs admin rights" />
        ) : (
          <Checkbox
            checked={props.checked}
            disabled={props.disabled}
            onCheckedChange={(v) => props.onCheck(v === true)}
            aria-label={`Select ${r.name}`}
          />
        )}
        <CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <ChevronRight className={cn('text-muted-foreground size-4 shrink-0 transition-transform', open && 'rotate-90')} />
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{r.name}</p>
            <p className="text-muted-foreground truncate text-xs">{r.whatItIs}</p>
          </div>
          {r.manualCommand ? (
            <Badge variant="secondary">Needs admin</Badge>
          ) : (
            <Badge variant="outline" className={risk.className}>
              <risk.icon /> {risk.label}
            </Badge>
          )}
          <span className="w-20 text-right font-medium tabular-nums">{formatBytes(r.bytes)}</span>
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent>
        <div className="bg-muted/30 grid gap-3 border-t px-4 py-4 pl-14 text-sm md:grid-cols-2">
          <Explain title="You gain" text={r.gain} tone="text-success" />
          <Explain title="You might lose" text={r.loss} tone={r.risk === 'medium' ? 'text-destructive' : 'text-warning'} />
          {r.tip && (
            <p className="text-muted-foreground flex items-center gap-1.5 md:col-span-2">
              <Lightbulb className="size-4" /> {r.tip}
            </p>
          )}
          {r.manualCommand && (
            <div className="md:col-span-2">
              <p className="text-muted-foreground mb-1">This needs administrator rights, so the app won't do it for you. Run:</p>
              <div className="bg-background flex items-center justify-between gap-2 rounded-md border px-3 py-2 font-mono text-xs">
                <span className="select-text">{r.manualCommand}</span>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-7"
                  aria-label="Copy command"
                  onClick={() => navigator.clipboard.writeText(r.manualCommand!).then(() => toast('Copied'))}
                >
                  <Copy />
                </Button>
              </div>
            </div>
          )}
          <div className="text-muted-foreground flex items-center justify-between gap-2 text-xs md:col-span-2">
            <span className="truncate font-mono" title={r.paths.join('\n')}>
              {r.paths[0]}
              {r.paths.length > 1 && ` +${r.paths.length - 1} more`} · {r.files.toLocaleString()} files
              {r.unreadable > 0 && ` · ${r.unreadable} unreadable`}
            </span>
            <Button size="sm" variant="ghost" onClick={() => window.api.openTarget(r.id)}>
              <FolderOpen /> Open folder
            </Button>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

function Explain({ title, text, tone }: { title: string; text: string; tone: string }) {
  return (
    <div>
      <p className={cn('mb-0.5 text-xs font-semibold tracking-wide uppercase', tone)}>{title}</p>
      <p>{text}</p>
    </div>
  )
}
