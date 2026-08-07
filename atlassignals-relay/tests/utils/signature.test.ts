import { describe, expect, it } from 'vitest';
import { computeSignature, verifyHmacSignature } from '../../src/middleware/verifySignature';

const SECRET = 'unit-test-secret';
const BODY = Buffer.from('{"hello":"world","n":42}');

describe('verifyHmacSignature', () => {
  it('accepts a correctly signed body', () => {
    const sig = computeSignature(BODY, SECRET);
    expect(verifyHmacSignature(BODY, sig, SECRET)).toBe(true);
  });

  it('rejects a tampered body', () => {
    const sig = computeSignature(BODY, SECRET);
    const tampered = Buffer.from('{"hello":"world","n":43}');
    expect(verifyHmacSignature(tampered, sig, SECRET)).toBe(false);
  });

  it('rejects a signature computed with a different secret', () => {
    const sig = computeSignature(BODY, 'other-secret');
    expect(verifyHmacSignature(BODY, sig, SECRET)).toBe(false);
  });

  it('rejects a missing signature header', () => {
    expect(verifyHmacSignature(BODY, undefined, SECRET)).toBe(false);
  });

  it('rejects when the raw body is missing', () => {
    const sig = computeSignature(BODY, SECRET);
    expect(verifyHmacSignature(undefined, sig, SECRET)).toBe(false);
  });

  it('rejects when the secret is empty', () => {
    const sig = computeSignature(BODY, SECRET);
    expect(verifyHmacSignature(BODY, sig, '')).toBe(false);
  });

  it('is stable for the same body+secret (canonical signing)', () => {
    expect(computeSignature(BODY, SECRET)).toBe(computeSignature(BODY, SECRET));
  });
});
