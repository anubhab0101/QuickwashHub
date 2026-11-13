import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function createMfaSecret() {
  let bits = 0, buffer = 0, output = '';
  for (const byte of randomBytes(20)) { buffer = (buffer << 8) | byte; bits += 8; while (bits >= 5) { output += alphabet[(buffer >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits) output += alphabet[(buffer << (5 - bits)) & 31];
  return output;
}

function decodeBase32(value: string) {
  let bits = 0, buffer = 0; const output: number[] = [];
  for (const char of value.toUpperCase().replace(/=+$/g, '')) { const digit = alphabet.indexOf(char); if (digit < 0) throw new Error('Invalid TOTP secret.'); buffer = (buffer << 5) | digit; bits += 5; if (bits >= 8) { output.push((buffer >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(output);
}

function encryptionKey(authTokenSecret: string) {
  if (authTokenSecret.length < 32) throw new Error('The signing secret is not strong enough to derive the MFA encryption key.');
  return createHash('sha256').update('quickwashhub-admin-mfa:' + authTokenSecret).digest();
}

export function encryptMfaSecret(secret: string, authTokenSecret: string) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', encryptionKey(authTokenSecret), iv);
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return [iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.');
}

export function decryptMfaSecret(value: string, authTokenSecret: string) {
  const [iv, tag, encrypted] = value.split('.'); if (!iv || !tag || !encrypted) throw new Error('Invalid encrypted MFA secret.');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(authTokenSecret), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64url')), decipher.final()]).toString('utf8');
}

export function totpAt(secret: string, timeMs = Date.now()) {
  const counter = Math.floor(timeMs / 30_000), input = Buffer.alloc(8); input.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', decodeBase32(secret)).update(input).digest(), offset = digest[digest.length - 1] & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

export function verifyTotp(secret: string, code: string, timeMs = Date.now()) {
  if (!/^\d{6}$/.test(code)) return false;
  const submitted = Buffer.from(code);
  for (const offset of [-30_000, 0, 30_000]) { const expected = Buffer.from(totpAt(secret, timeMs + offset)); if (submitted.length === expected.length && timingSafeEqual(submitted, expected)) return true; }
  return false;
}
