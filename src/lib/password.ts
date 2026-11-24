import crypto from 'node:crypto';

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, storedValue: string): boolean {
  if (typeof storedValue !== 'string') return false;

  try {
    const separator = storedValue.indexOf(':');
    if (separator <= 0) return false;

    const salt = storedValue.slice(0, separator);
    const storedHash = storedValue.slice(separator + 1);
    if (!/^[\da-f]{128}$/i.test(storedHash)) return false;

    const passwordHash = crypto.scryptSync(password, salt, 64);
    return crypto.timingSafeEqual(passwordHash, Buffer.from(storedHash, 'hex'));
  } catch {
    return false;
  }
}
