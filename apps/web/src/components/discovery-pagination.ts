/** Stored-result navigation only. Preserve repeated terms without carrying action/quote state. */
export function discoveryPageLinks(params: URLSearchParams, cursor: string | undefined, nextCursor: string | null) {
  const decoded = cursor ? Buffer.from(cursor, 'base64url').toString() : '0';
  const value = /^\d+$/.test(decoded) ? Number(decoded) : 0;
  const offset = Number.isSafeInteger(value) && value >= 0 ? value : 0;
  const href = (target: string | null) => {
    const query = new URLSearchParams(params);
    query.delete('cursor');
    if (target) query.set('cursor', target);
    return `/app/discover${query.size ? `?${query}` : ''}`;
  };
  return {
    page: Math.floor(offset / 50) + 1,
    previous: offset > 0 ? href(offset > 50 ? Buffer.from(String(offset - 50)).toString('base64url') : null) : null,
    next: nextCursor ? href(nextCursor) : null,
  };
}
