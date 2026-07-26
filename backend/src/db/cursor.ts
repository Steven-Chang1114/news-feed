/**
 * Keyset pagination cursors.
 *
 * A cursor encodes the sort key of the last row on a page — `(created_at, id)` —
 * so the next page asks for "rows ordered after this one" rather than "skip 20".
 * With OFFSET, analyzing an article mid-scroll shifts every later row down and the
 * reader silently sees a duplicate; keyset pagination is stable under inserts
 * because the anchor is a position in the ordering, not a count.
 *
 * `id` is part of the key because `created_at` is not unique: two analyses created
 * in the same millisecond would otherwise make the boundary ambiguous and could
 * drop or repeat a row.
 *
 * Base64 is encoding, not security. It signals "opaque, do not parse" to clients,
 * and it survives being put in a query string. A tampered cursor is handled by
 * `decodeCursor` returning null.
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
