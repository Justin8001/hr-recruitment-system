import crypto from 'node:crypto';

const ALG = 'aes-256-gcm';

function key(): Buffer {
  const k = process.env.ENCRYPTION_KEY;
  if (!k) throw new Error('ENCRYPTION_KEY is not set');
  const buf = Buffer.from(k, 'base64');
  if (buf.length !== 32) throw new Error('ENCRYPTION_KEY must decode to 32 bytes (base64)');
  return buf;
}

/** Encrypts a string with AES-256-GCM. Output: iv.tag.ciphertext (base64, dot-separated). */
export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALG, key(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join('.');
}

export function decrypt(blob: string): string {
  const [ivb, tagb, encb] = blob.split('.');
  const decipher = crypto.createDecipheriv(ALG, key(), Buffer.from(ivb, 'base64'));
  decipher.setAuthTag(Buffer.from(tagb, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(encb, 'base64')), decipher.final()]).toString('utf8');
}
