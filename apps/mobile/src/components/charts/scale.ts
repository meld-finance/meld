/** Round step (1, 2, 2.5 or 5 × 10ⁿ) so `count` ticks cover `span`. */
export function niceStep(span: number, count: number) {
  const raw = span / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  return ([1, 2, 2.5, 5, 10].find((m) => m * pow >= raw) ?? 10) * pow;
}

/** A y-scale from zero (or below, for negative values) up to a round number, with its ticks. */
export function zeroBasedScale(values: number[], ticks: number) {
  const lo = Math.min(0, ...values);
  const hi = Math.max(...values);
  const step = niceStep(hi - lo || Math.abs(hi) || 1, ticks - 1);
  const min = Math.floor(lo / step) * step;
  const max = Math.max(Math.ceil(hi / step) * step, min + step);
  return { min, max, ticks: Array.from({ length: Math.round((max - min) / step) + 1 }, (_, i) => min + i * step) };
}
