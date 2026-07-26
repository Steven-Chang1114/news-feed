import { describe, expect, it } from 'vitest';
import { decodeCursor, encodeCursor } from './cursor';

describe('cursor', () => {
  const cursor = { createdAt: new Date('2026-07-26T10:00:00.123Z'), id: 'a1b2c3d4-0000-4000-8000-000000000000' };

  it('round-trips without losing millisecond precision', () => {
    // Truncating to seconds would make two analyses created in the same second
    // ambiguous at a page boundary.
    const decoded = decodeCursor(encodeCursor(cursor));
    expect(decoded?.createdAt.toISOString()).toBe(cursor.createdAt.toISOString());
    expect(decoded?.id).toBe(cursor.id);
  });

  it('produces a URL-safe string', () => {
    // base64url, not base64: a "+" or "/" in a query string would be mangled.
    expect(encodeCursor(cursor)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it.each([
    ['not base64 at all', '!!!not-base64!!!'],
    ['base64 without a separator', Buffer.from('nopipe').toString('base64url')],
    ['an unparseable timestamp', Buffer.from('never|some-id').toString('base64url')],
    ['a missing id', Buffer.from('2026-07-26T10:00:00Z|').toString('base64url')],
    ['an empty string', ''],
  ])('returns null for %s rather than throwing', (_label, value) => {
    // A tampered or truncated cursor must degrade to a 400, never a 500.
    expect(decodeCursor(value)).toBeNull();
  });
});
