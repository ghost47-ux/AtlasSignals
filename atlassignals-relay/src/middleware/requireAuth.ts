/**
 * requireAuth.ts — JWT authentication + signal access enforcement.
 *
 * The read API and payment initialization require a Supabase Auth JWT
 * (`Authorization: Bearer <token>`). The token is validated against the Auth
 * server, then resolved to a `public.users` row via `auth_id`. Access to
 * signals is then decided by the SAME database function the RLS policies use
 * (`user_can_access_signals_for`) — the backend never re-implements the
 * subscription window logic, so app and database can never disagree.
 *
 * `/stream` additionally accepts `?token=` (EventSource cannot set headers).
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { DbClient } from '../db/supabase';

export interface AppUser {
  id: string;
  role: string;
  email: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    appUser?: AppUser;
  }
}

export type VerifyJwtFn = (token: string) => Promise<{ sub: string } | null>;

export type AuthMiddleware = (
  request: FastifyRequest,
  reply: FastifyReply,
) => Promise<FastifyReply | undefined>;

/** Default token verifier: ask Supabase Auth to validate the JWT. */
export function createDefaultVerifyJwt(db: DbClient): VerifyJwtFn {
  return async (token: string) => {
    const { data, error } = await db.auth.getUser(token);
    if (error || !data.user) {
      return null;
    }
    return { sub: data.user.id };
  };
}

export interface RequireAuthOptions {
  db: DbClient;
  verifyJwt: VerifyJwtFn;
  /** Allow `?token=` fallback (needed by EventSource clients on /stream). */
  allowQueryToken?: boolean;
}

export function makeRequireAuth(opts: RequireAuthOptions): AuthMiddleware {
  const { db, verifyJwt, allowQueryToken = false } = opts;

  return async function requireAuth(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<FastifyReply | undefined> {
    let header = request.headers.authorization;

    if (!header && allowQueryToken) {
      const token = (request.query as { token?: string } | undefined)?.token;
      if (token) {
        header = `Bearer ${token}`;
      }
    }

    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
    if (!token) {
      return reply.code(401).send({ error: 'unauthorized' });
    }

    const authUser = await verifyJwt(token);
    if (!authUser?.sub) {
      return reply.code(401).send({ error: 'invalid_token' });
    }

    const { data, error } = await db
      .from('users')
      .select('id, role, email')
      .eq('auth_id', authUser.sub)
      .maybeSingle();
    if (error) {
      request.log.error({ err: error }, 'auth: user lookup failed');
      return reply.code(500).send({ error: 'internal_error' });
    }
    if (!data) {
      // Auth user exists but no profile row (e.g. created outside the
      // handle_new_user trigger) — treat as unprovisioned.
      return reply.code(403).send({ error: 'user_not_provisioned' });
    }

    request.appUser = data as AppUser;
    return undefined;
  };
}

/**
 * Enforce signal visibility with the DB function (role + trial/paid window,
 * now()-based). Blocks expired trial/paid users and any non-admin without a
 * live window. The frontend should surface this as an upgrade prompt.
 */
export function makeRequireSignalAccess(db: DbClient): AuthMiddleware {
  return async function requireSignalAccess(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<FastifyReply | undefined> {
    const user = request.appUser;
    if (!user) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    const { data, error } = await db.rpc('user_can_access_signals_for', {
      p_user_id: user.id,
    });
    if (error) {
      request.log.error({ err: error }, 'access: visibility check failed');
      return reply.code(500).send({ error: 'internal_error' });
    }
    if (data !== true) {
      return reply.code(403).send({ error: 'access_denied' });
    }
    return undefined;
  };
}
