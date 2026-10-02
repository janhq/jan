type TranslateFn = (key: string, options?: Record<string, unknown>) => string

const SECONDS_PER_MINUTE = 60
const SECONDS_PER_HOUR = 60 * SECONDS_PER_MINUTE

/**
 * Elapsed time as at most two units: "45s", "1m 30s", "1h 20m". Abbreviated
 * units keep the label short enough for an inline header and avoid per-language
 * plural rules, which the translation layer does not implement.
 */
export function formatCompactDuration(
  totalSeconds: number,
  t: TranslateFn
): string {
  const seconds = Math.max(0, Math.floor(totalSeconds))

  if (seconds < SECONDS_PER_MINUTE) {
    return t('common:duration.seconds', { count: seconds })
  }

  if (seconds < SECONDS_PER_HOUR) {
    const minutes = t('common:duration.minutes', {
      count: Math.floor(seconds / SECONDS_PER_MINUTE),
    })
    const rest = seconds % SECONDS_PER_MINUTE
    return rest === 0
      ? minutes
      : `${minutes} ${t('common:duration.seconds', { count: rest })}`
  }

  const hours = t('common:duration.hours', {
    count: Math.floor(seconds / SECONDS_PER_HOUR),
  })
  const rest = Math.floor((seconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE)
  return rest === 0
    ? hours
    : `${hours} ${t('common:duration.minutes', { count: rest })}`
}
