/** Accept a pasted single hashtag as a keyword without sending its surrounding markers. */
export function normalizeSearchQuery(value: string): string {
  return value.trim().replace(/^[#＃]+|[#＃]+$/g, '').trim();
}
