/**
 * useSignals.ts — live signal feed for the dashboard.
 *
 * Reads through RLS (anon + user session): a user without a live trial/paid
 * window simply receives an empty feed. Updates arrive via Supabase Realtime
 * (INSERT on `signals`, RLS-filtered); a light polling fallback + visibility
 * refresh keep the feed accurate even if the socket drops.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase, type SignalRow } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

const POLL_MS = 25_000;
const PAGE = 30;

export function useSignals() {
  const { session, access } = useAuth();
  const [signals, setSignals] = useState<SignalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [live, setLive] = useState(false);
  const mounted = useRef(true);

  const canRead = Boolean(session && access.ok);

  const fetchFeed = useCallback(async () => {
    const { data, error } = await supabase
      .from('signals')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(PAGE);
    if (!error && data) {
      setSignals(data as SignalRow[]);
    }
    return !error;
  }, []);

  useEffect(() => {
    mounted.current = true;
    if (!canRead) {
      setSignals([]);
      setLoading(false);
      setLive(false);
      return;
    }

    setLoading(true);
    void fetchFeed().finally(() => {
      if (mounted.current) setLoading(false);
    });

    // Realtime (RLS-filtered INSERTs).
    const channel = supabase
      .channel('signals-live')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'signals' },
        (payload) => {
          if (!mounted.current) return;
          const row = payload.new as SignalRow;
          setLive(true);
          setSignals((prev) => {
            if (prev.some((s) => s.signal_id === row.signal_id)) return prev;
            return [row, ...prev].slice(0, PAGE);
          });
        },
      )
      .subscribe((status) => {
        if (mounted.current && status === 'SUBSCRIBED') setLive(true);
      });

    const poll = window.setInterval(() => {
      void fetchFeed();
    }, POLL_MS);

    const onFocus = () => void fetchFeed();
    window.addEventListener('focus', onFocus);

    return () => {
      mounted.current = false;
      window.clearInterval(poll);
      window.removeEventListener('focus', onFocus);
      void supabase.removeChannel(channel);
    };
  }, [canRead, fetchFeed]);

  const refresh = useCallback(() => fetchFeed(), [fetchFeed]);

  return { signals, loading, live, refresh };
}
