export type CoverCandidate = { id: string; coverUrl: string | null };

/** A URL existing in the database does not mean the browser can load it. */
export function repairableCoverIds(notes: readonly CoverCandidate[], failedSources: Readonly<Record<string, string>>): string[] {
  return notes.filter(n => !n.coverUrl || failedSources[n.id] === n.coverUrl).map(n => n.id).slice(0, 50);
}
