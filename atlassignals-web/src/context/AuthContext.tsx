/**
 * AuthContext.tsx — session + profile + subscription state for the whole app.
 *
 * The database (RLS + user_can_access_signals_for) is the enforcement point;
 * this context only mirrors the rows the authenticated user is allowed to see
 * for UI display (role badge, countdown, upgrade prompts).
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, type DeliveryChannelRow, type ProfileRow, type SubscriptionRow } from '../lib/supabase';

export interface AccessState {
  ok: boolean;
  kind: 'admin' | 'trial' | 'paid' | 'trial_pending' | 'trial_expired' | 'paid_expired' | 'none';
  starts?: number;
  ends?: number;
}

interface AuthContextValue {
  session: Session | null;
  profile: ProfileRow | null;
  subscription: SubscriptionRow | null;
  channels: DeliveryChannelRow[];
  access: AccessState;
  loading: boolean;
  refreshing: boolean;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [subscription, setSubscription] = useState<SubscriptionRow | null>(null);
  const [channels, setChannels] = useState<DeliveryChannelRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadProfile = useCallback(async (sess: Session) => {
    setRefreshing(true);
    try {
      const uid = sess.user.id;

      const { data: profileData, error: profileError } = await supabase
        .from('users')
        .select('id, auth_id, email, role, created_at, updated_at')
        .eq('auth_id', uid)
        .maybeSingle();
      if (profileError) {
        console.error('profile fetch failed', profileError);
        return;
      }
      if (!profileData) {
        setProfile(null);
        setSubscription(null);
        setChannels([]);
        return;
      }
      setProfile(profileData as ProfileRow);

      const { data: subData, error: subError } = await supabase
        .from('subscriptions')
        .select('*')
        .eq('user_id', profileData.id)
        .order('created_at', { ascending: false })
        .limit(1);
      if (!subError && subData && subData.length > 0) {
        setSubscription(subData[0] as SubscriptionRow);
      } else {
        setSubscription(null);
      }

      const { data: channelData, error: channelError } = await supabase
        .from('delivery_channels')
        .select('*')
        .eq('user_id', profileData.id);
      setChannels(
        !channelError && channelData ? (channelData as DeliveryChannelRow[]) : [],
      );
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (data.session) {
        void loadProfile(data.session);
      }
      setLoading(false);
    });

    const {
      data: { subscription: authSub },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      if (newSession) {
        void loadProfile(newSession);
      } else {
        setProfile(null);
        setSubscription(null);
        setChannels([]);
      }
    });

    return () => authSub.unsubscribe();
  }, [loadProfile]);

  const refreshProfile = useCallback(async () => {
    const {
      data: { session: sess },
    } = await supabase.auth.getSession();
    if (sess) {
      await loadProfile(sess);
    }
  }, [loadProfile]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setProfile(null);
    setSubscription(null);
    setChannels([]);
  }, []);

  const access = useMemo<AccessState>(() => {
    if (!profile) return { ok: false, kind: 'none' };
    if (profile.role === 'admin') return { ok: true, kind: 'admin' };
    if (!subscription) return { ok: false, kind: 'none' };

    const now = Date.now();
    if (subscription.status === 'trial') {
      const starts = new Date(subscription.started_at).getTime();
      const ends = subscription.trial_ends_at
        ? new Date(subscription.trial_ends_at).getTime()
        : null;
      if (ends && now < ends) {
        return { ok: true, kind: 'trial', starts, ends };
      }
      if (starts > now) {
        return { ok: false, kind: 'trial_pending', starts, ends: ends ?? undefined };
      }
      return { ok: false, kind: 'trial_expired', starts, ends: ends ?? undefined };
    }
    if (subscription.status === 'active') {
      const starts = new Date(subscription.started_at).getTime();
      const ends = subscription.ends_at ? new Date(subscription.ends_at).getTime() : null;
      if (ends && now < ends) {
        return { ok: true, kind: 'paid', starts, ends };
      }
      return { ok: false, kind: 'paid_expired', starts, ends: ends ?? undefined };
    }
    return { ok: false, kind: 'none' };
  }, [profile, subscription]);

  const value = useMemo(
    () => ({
      session,
      profile,
      subscription,
      channels,
      access,
      loading,
      refreshing,
      signOut,
      refreshProfile,
    }),
    [session, profile, subscription, channels, access, loading, refreshing, signOut, refreshProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside <AuthProvider>');
  }
  return ctx;
}
