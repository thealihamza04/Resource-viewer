import { useEffect, useState } from 'react'
import { Copy, Minus, Square, X } from 'lucide-react'
import { cn } from '@/lib/utils'

const btn =
  'text-muted-foreground hover:text-foreground hover:bg-accent focus-visible:ring-ring/50 grid h-8 w-10 place-items-center rounded-md transition-colors outline-none focus-visible:ring-2 [&_svg]:size-4'

/** Minimize / maximize / close for the frameless window (Windows & Linux). */
export function WindowControls() {
  const [maximized, setMaximized] = useState(false)
  const win = window.api.win

  useEffect(() => {
    win.isMaximized().then(setMaximized)
    return win.onMaximizedChange(setMaximized)
  }, [win])

  if (win.platform === 'darwin') return null // macOS draws its own traffic lights

  return (
    <div className="no-drag flex items-center gap-0.5">
      <button type="button" className={btn} onClick={() => win.minimize()} aria-label="Minimize" title="Minimize">
        <Minus />
      </button>
      <button
        type="button"
        className={btn}
        onClick={() => win.toggleMaximize()}
        aria-label={maximized ? 'Restore' : 'Maximize'}
        title={maximized ? 'Restore' : 'Maximize'}
      >
        {maximized ? <Copy className="-scale-x-100" /> : <Square className="!size-3.5" />}
      </button>
      <button
        type="button"
        className={cn(btn, 'hover:bg-destructive hover:text-white')}
        onClick={() => win.close()}
        aria-label="Close"
        title="Close"
      >
        <X />
      </button>
    </div>
  )
}
