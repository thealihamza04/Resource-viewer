import { useEffect, useState } from 'react'
import { Activity, HardDrive, ListTree, Sparkles } from 'lucide-react'
import logo from '@/assets/logo.png'
import type { StaticInfo } from '../../shared/types'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useSnapshots } from '@/hooks/useSnapshots'
import { Overview } from '@/features/Overview'
import { Cleanup } from '@/features/Cleanup'
import { Processes } from '@/features/Processes'
import { Storage } from '@/features/Storage'
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
              'grid h-10 grid-cols-[1fr_auto_1fr] items-center gap-4 pr-1',
              window.api.win.platform === 'darwin' ? 'pl-20' : 'pl-3'
            )}
          >
            <div className="flex min-w-0 items-center gap-2">
              <img src={logo} alt="" className="size-5 shrink-0" draggable={false} />
              <h1 className="truncate text-[13px] font-semibold">Resource Viewer</h1>
            </div>
            <TabsList className="no-drag group-data-[orientation=horizontal]/tabs:h-7 p-0.5">
              <TabsTrigger className="gap-1 px-2.5 text-xs [&_svg:not([class*='size-'])]:size-3.5" value="overview">
                <Activity /> Overview
              </TabsTrigger>
              <TabsTrigger className="gap-1 px-2.5 text-xs [&_svg:not([class*='size-'])]:size-3.5" value="cleanup">
                <Sparkles /> Cleanup
              </TabsTrigger>
              <TabsTrigger className="gap-1 px-2.5 text-xs [&_svg:not([class*='size-'])]:size-3.5" value="storage">
                <HardDrive /> Storage
              </TabsTrigger>
              <TabsTrigger className="gap-1 px-2.5 text-xs [&_svg:not([class*='size-'])]:size-3.5" value="processes">
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
            <TabsContent value="storage" forceMount className="data-[state=inactive]:hidden">
              <Storage active={tab === 'storage'} />
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
