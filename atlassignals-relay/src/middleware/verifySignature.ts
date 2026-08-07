/**
 * verifySignature.ts — HMAC-SHA256 webhook signature verification.
 *
 * Contract:
 *   header   x-atlas-signature   hex HMAC-SHA256 of the EXACT request body
 *   secret   WEBHOOK_SECRET      shared between the Space and the backend
 *
 * The body bytes are captured verbatim by the `rawBody` onRequest hook in
 * app.ts — re-serializing `request.body` would break verification, so the
 * signature is always computed over the original stream.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: Buffer;
  }
}

export function computeSignature(rawBody: Buffer, secret: string): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

export function verifyHmacSignature(
  rawBody: Buffer | undefined,
  signatureHeader: string | undefined,
  secret: string,
): boolean {
  if (!rawBody || rawBody.length === 0 || !signatureHeader || !secret) {
    return false;
  }
  const expected = Buffer.from(computeSignature(rawBody, secret), 'utf8');
  const provided = Buffer.from(signatureHeader.trim(), 'utf8');
  if (expected.length !== provided.length) {
    return false;
  }
  return timingSafeEqual(expected, provided);
}

/**
 * Build a Fastify preHandler that rejects requests without a valid signature.
 * `getSecret` is a function so tests can swap the secret without rebuilding.
 */
export function makeVerifySignature(getSecret: () => string) {
  return async function verifySignature(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<FastifyReply | undefined> {
    const rawBody = request.rawBody;
    const header = request.headers['x-atlas-signature'] as string | undefined;
    const secret = getSecret();

    if (!secret) {
      request.log.error('WEBHOOK_SECRET is not configured — rejecting request.');
      return reply.code(503).send({ error: 'server_not_configured' });
    }
    if (!verifyHmacSignature(rawBody, header, secret)) {
      request.log.warn({ remote: request.ip }, 'webhook: invalid signature');
      return reply.code(401).send({ error: 'invalid_signature' });
    }
    return undefined;
  };
}
