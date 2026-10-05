/**
 * Spec 5.4 / principle 12: third-party text is data. Wrap it in a quoted boundary
 * the prompt template declares as non-instructional; strip anything that could
 * close the boundary early.
 */
export function quoteUntrusted(label: string, text: string): string {
  const safeLabel = label.replace(/[^a-z0-9_]/gi, '');
  const body = text.replace(/<\/?untrusted[^>]*>/gi, '');
  return `<untrusted source="${safeLabel}">\n${body}\n</untrusted>`;
}
