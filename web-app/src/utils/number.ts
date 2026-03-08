export const toNumber = (value: unknown): number => {
  const num = Number(value)
  return isNaN(num) ? 0 : num
}
