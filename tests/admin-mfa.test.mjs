import test from 'node:test';
import assert from 'node:assert/strict';
import { createMfaSecret, decryptMfaSecret, encryptMfaSecret, totpAt, verifyTotp } from '../dist/src/security/admin-mfa.js';
import { calculateVehicleCouponDiscount } from '../dist/src/domain/coupon-pricing.js';

const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const SIGNING_SECRET = 'a-test-only-signing-secret-that-is-long-enough';

test('TOTP matches RFC 6238 SHA-1 six-digit vectors', () => {
  for (const [seconds, expected] of [[59, '287082'], [1111111109, '081804'], [1111111111, '050471'], [1234567890, '005924'], [2000000000, '279037'], [20000000000, '353130']]) {
    assert.equal(totpAt(RFC_SECRET, seconds * 1000), expected);
  }
});

test('TOTP accepts a one-step clock skew and rejects malformed codes', () => {
  const time = 1_700_000_000_000;
  assert.equal(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, time), time + 30_000), true);
  assert.equal(verifyTotp(RFC_SECRET, '12345', time), false);
  assert.equal(verifyTotp(RFC_SECRET, 'abcdef', time), false);
});

test('MFA secrets are encrypted at rest and authenticated', () => {
  const secret = createMfaSecret();
  assert.match(secret, /^[A-Z2-7]{32}$/);
  const encrypted = encryptMfaSecret(secret, SIGNING_SECRET);
  assert.notEqual(encrypted, secret);
  assert.equal(decryptMfaSecret(encrypted, SIGNING_SECRET), secret);
  const parts = encrypted.split('.'); parts[2] = Buffer.from('tampered').toString('base64url');
  assert.throws(() => decryptMfaSecret(parts.join('.'), SIGNING_SECRET));
  assert.throws(() => decryptMfaSecret(encrypted, 'wrong-signing-secret-long-enough-to-pass'));
});

test('coupon tiers choose the best eligible offer and preserve zone contribution', () => {
  const calculate = (vehicleTypes, baseCommission = 5000) => calculateVehicleCouponDiscount({ grossAmount: 10000, baseCommission, vehicleTypes, couponDiscountPct: 10, paymentFeePct: 2, minimumContributionPct: 1 });
  assert.equal(calculate(['BIKE']).offerPct, 10);
  assert.equal(calculate(['BIKE', 'BIKE']).offerPct, 15);
  assert.equal(calculate(['CAR', 'BIKE']).offerPct, 20);
  assert.equal(calculate(['CAR', 'CAR', 'CAR']).offerPct, 25);
  assert.equal(calculate(['BIKE', 'BIKE', 'BIKE', 'BIKE', 'BIKE']).offerPct, 30);
  const capped = calculate(['CAR'], 1000);
  assert.equal(capped.discount, 700);
  assert.equal(capped.remainingContribution, capped.minimumContribution);
  assert.equal(calculate(['CAR'], 250).discount, 0);
});
