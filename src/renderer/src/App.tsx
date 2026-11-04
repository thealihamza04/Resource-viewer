import { useEffect, useState } from 'react'
import { Activity, ListTree, Sparkles } from 'lucide-react'
import logo from '@/assets/logo.png'
import type { StaticInfo } from '../../shared/types'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useSnapshots } from '@/hooks/useSnapshots'
import { formatPercent } from '@/lib/format'
import { Overview } from '@/features/Overview'
import { Cleanup } from '@/features/Cleanup'
import { Processes } from '@/features/Processes'
import { WindowControls } from '@/components/WindowControls'
import { cn } from '@/lib/utils'

export default function App() {
  const [info, setInfo] = useState<StaticInfo | null>(null)
  const [tab, setTab] = useState('overview')
  const { latest, history } = useSnapshots()

  useEffect(() => {
    window.api.getStatic().then(setInfo)
  }, [])

  return (
    <TooltipProvider>
      <Tabs value={tab} onValueChange={setTab} className="flex h-full flex-col gap-0">
        {/* Custom title bar: empty areas drag the window; controls opt out with no-drag. */}
        <header className="drag sticky top-0 z-30 border-b border-hairline bg-background/70 backdrop-blur-xl backdrop-saturate-150">
          <div
            className={cn(
              'grid h-12 grid-cols-[1fr_auto_1fr] items-center gap-4 pr-2',
              window.api.win.platform === 'darwin' ? 'pl-20' : 'pl-4'
            )}
          >
            <div className="flex min-w-0 items-center gap-2.5">
              <img src={logo} alt="" className="size-7 shrink-0" draggable={false} />
              <div className="min-w-0">
                <h1 className="truncate text-[13px] leading-tight font-semibold">Resource Viewer</h1>
                <p className="text-muted-foreground truncate text-[11px] leading-tight tabular-nums">
                  {latest
                    ? `CPU ${formatPercent(latest.cpu)} · RAM ${formatPercent((latest.mem.used / latest.mem.total) * 100)}`
                    : 'Reading system…'}
                </p>
              </div>
            </div>
            <TabsList className="no-drag">
              <TabsTrigger value="overview">
                <Activity /> Overview
              </TabsTrigger>
              <TabsTrigger value="cleanup">
                <Sparkles /> Cleanup
              </TabsTrigger>
              <TabsTrigger value="processes">
                <ListTree /> Processes
              </TabsTrigger>
            </TabsList>
            <div className="flex justify-end">
              <WindowControls />
            </div>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-6xl px-8 py-8">
            <TabsContent value="overview">
              <Overview info={info} latest={latest} history={history} />
            </TabsContent>
            {/* forceMount keeps scan results when switching tabs */}
            <TabsContent value="cleanup" forceMount className="data-[state=inactive]:hidden">
              <Cleanup active={tab === 'cleanup'} />
            </TabsContent>
            <TabsContent value="processes">
              <Processes />
            </TabsContent>
          </div>
        </main>
      </Tabs>
      <Toaster position="bottom-right" />
    </TooltipProvider>
  )
}
