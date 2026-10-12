/** datetime-local fields in this Korean-time workspace have no browser timezone suffix. */
export function koreanLocalTimeToIso(value: string): string | undefined {
  if (!value) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value)) throw new Error('한국 시간 날짜와 시각을 확인하세요.');
  const check = new Date(`${value}Z`);
  if (!Number.isFinite(check.getTime()) || check.toISOString().slice(0,value.length) !== value) throw new Error('한국 시간 날짜와 시각을 확인하세요.');
  return new Date(`${value}+09:00`).toISOString();
}
