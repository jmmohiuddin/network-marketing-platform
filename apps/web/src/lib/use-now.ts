'use client'

import { useEffect, useState } from 'react'

/** Ticks every intervalMs: for countdowns (the support-session countdown is the only one, UI-04). */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}
