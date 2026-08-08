-- ============================================================================
-- AtlasSignals Relay — 0009 · Realtime broadcast for the dashboard
-- ----------------------------------------------------------------------------
-- The website's dashboard live-updates when a new signal lands. The clean
-- serverless-friendly path is Supabase Realtime (WebSocket), which respects
-- RLS: an `authenticated` subscriber only receives rows they could SELECT —
-- i.e. user_can_access_signals() gates the broadcast exactly like the REST
-- read path. No extra routing layer; the web just subscribes to
-- postgres_changes on `signals`.
--
-- The publication exists by default on Supabase projects. Guarded so this
-- migration is a no-op on projects where it is already a member.
-- ============================================================================

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'signals'
     ) then
    alter publication supabase_realtime add table public.signals;
  end if;
end $$;
