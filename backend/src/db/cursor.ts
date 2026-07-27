/**
 * Keyset pagination cursors.
 *
 * A cursor encodes the sort key of the last row on a page — `(created_at, id)` — so
 * the next page asks for rows positioned after it in the ordering. Because the
 * anchor is a position and not a count, analyses added at the head cannot shift a
 * reader onto a row they have already seen.
 *
 * `id` is part of the key because `created_at` is not unique: two analyses created
 * in the same millisecond would otherwise make the page boundary ambiguous.
 *
 * Base64 is encoding, not security. It marks the value as opaque and survives a
 * query string; a tampered cursor is handled by `decodeCursor` returning null.
 */

export interface Cursor {
  createdAt: Date;
  id: string;
}

export function encodeCursor({ createdAt, id }: Cursor): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`, 'utf8').toString('base64url');
}

/** Returns null for anything malformed, so a bad cursor is a 400 rather than a crash. */
export function decodeCursor(cursor: string): Cursor | null {
  let decoded: string;
  try {
    decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  } catch {
    return null;
  }

  const separator = decoded.indexOf('|');
  if (separator === -1) return null;

  const timestamp = decoded.slice(0, separator);
  const id = decoded.slice(separator + 1);
  if (!id) return null;

  const createdAt = new Date(timestamp);
  if (Number.isNaN(createdAt.getTime())) return null;

  return { createdAt, id };
}
