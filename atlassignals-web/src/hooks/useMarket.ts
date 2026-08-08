/**
 * useMarket.ts — market session helpers + a ticking clock hook.
 *
 * XAU/USD (forex) is closed Saturday + Sunday (UTC). The signal engine runs
 * Monday–Friday, so the site surfaces market-open state and the weekend trial
 * rule consistently with migration 0008 (signup Sat/Sun → trial starts Monday
 * 00:00 UTC).
 */
import { useEffect, useState } from 'react';

export interface MarketInfo {
  marketOpen: boolean;
  isWeekend: boolean;
  /** Next Monday 00:00 UTC when the market is closed, else null. */
  nextOpen: Date | null;
}

export function getMarketInfo(now: Date = new Date()): MarketInfo {
  const dow = now.getUTCDay();
  const hour = now.getUTCHours();
  // Saturday or Sunday → closed.
  if (dow === 0 || dow === 6) {
    return { marketOpen: false, isWeekend: true, nextOpen: nextMondayUtc(now) };
  }
  // Friday 21:00 UTC onwards → closed for the weekend.
  if (dow === 5 && hour >= 21) {
    return { marketOpen: false, isWeekend: true, nextOpen: nextMondayUtc(now) };
  }
  return { marketOpen: true, isWeekend: false, nextOpen: null };
}

/** Next Monday 00:00 UTC (used by both the market info and the trial copy). */
export function nextMondayUtc(from: Date = new Date()): Date {
  const d = new Date(from);
  const daysUntilMonday = (8 - d.getUTCDay()) % 7; // Sun(0)→1 … Sat(6)→2
  d.setUTCDate(d.getUTCDate() + daysUntilMonday);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/** Re-render every `intervalMs` — for countdowns and clocks. */
export function useNow(intervalMs = 1000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}
