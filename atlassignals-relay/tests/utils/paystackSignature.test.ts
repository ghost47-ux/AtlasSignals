import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  fromKobo,
  toKobo,
  verifyPaystackSignature,
} from '../../src/services/paystackService';

const SECRET = 'sk_test_1234567890';
const BODY = Buffer.from('{"event":"charge.success","data":{"reference":"atlas_abc","amount":500000}}');

function sign(body: Buffer, secret: string): string {
  return createHmac('sha512', secret).update(body).digest('hex');
}

describe('verifyPaystackSignature', () => {
  it('accepts a correctly signed body', () => {
    expect(verifyPaystackSignature(BODY, sign(BODY, SECRET), SECRET)).toBe(true);
  });

  it('rejects a tampered body', () => {
    const sig = sign(BODY, SECRET);
    const tampered = Buffer.from('{"event":"charge.success","data":{"reference":"atlas_abc","amount":1}}');
    expect(verifyPaystackSignature(tampered, sig, SECRET)).toBe(false);
  });

  it('rejects a signature computed with a different secret', () => {
    const sig = sign(BODY, 'sk_test_wrong');
    expect(verifyPaystackSignature(BODY, sig, SECRET)).toBe(false);
  });

  it('rejects a missing signature header', () => {
    expect(verifyPaystackSignature(BODY, undefined, SECRET)).toBe(false);
  });

  it('rejects when the raw body is missing', () => {
    expect(verifyPaystackSignature(undefined, sign(BODY, SECRET), SECRET)).toBe(false);
  });

  it('rejects when the secret is empty', () => {
    expect(verifyPaystackSignature(BODY, sign(BODY, SECRET), '')).toBe(false);
  });
});

describe('amount conversion (minor ↔ major units)', () => {
  it('converts kobo to naira', () => {
    expect(fromKobo(500000)).toBe(5000);
    expect(fromKobo(0)).toBe(0);
    expect(fromKobo(undefined)).toBeNull();
  });

  it('converts naira to kobo', () => {
    expect(toKobo(5000)).toBe(500000);
  });
});
