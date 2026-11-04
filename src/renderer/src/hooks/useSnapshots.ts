import { useEffect, useRef, useState } from 'react'
import type { Snapshot } from '../../../shared/types'
import type { Sample } from '@/components/LiveChart'

export const HISTORY_SECONDS = 60

/**
 * Polls system usage once per second. The rolling history lives in a ref so the
 * live chart can read it every animation frame without causing React renders.
 */
export function useSnapshots() {
  const [latest, setLatest] = useState<Snapshot | null>(null)
  const history = useRef<Sample[]>([])

  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout>
    const tick = async () => {
      try {
        const s = await window.api.getSnapshot()
        if (!alive) return
        history.current.push({ t: s.time, values: {
            cpu: s.cpu,
            mem: (s.mem.used / s.mem.total) * 100,
            ...Object.fromEntries(s.cores.map((c, i) => [`core${i}`, c]))
          } })
        const cutoff = s.time - (HISTORY_SECONDS + 5) * 1000
        while (history.current.length && history.current[0].t < cutoff) history.current.shift()
        setLatest(s)
      } finally {
        if (alive) timer = setTimeout(tick, 1000)
      }
    }
    tick()
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [])

  return { latest, history }
}
