export function nextCoworkContextSize(
  current: number,
  max: number
): number | undefined {
  const candidate =
    current < 8192 ? 8192 : current < 32768 ? 32768 : Math.round(current * 1.5)
  const next = Math.min(candidate, max)
  return next > current ? next : undefined
}
