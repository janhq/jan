type FormatDateOptions = {
  includeTime?: boolean
}

export const formatDate = (
  date: string | number | Date,
  options?: FormatDateOptions
): string => {
  const includeTime = options?.includeTime ?? true

  // Base options shared across both modes
  const base: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    day: 'numeric',
  }

  if (includeTime) {
    // Time mode: short month + time, using local timezone
    return new Date(date).toLocaleString('en-US', {
      ...base,
      month: 'short',
      hour: 'numeric',
      minute: 'numeric',
      hour12: true,
    })
  }

  // Date-only mode: long month, using local timezone
  return new Date(date).toLocaleDateString('en-US', {
    ...base,
    month: 'long',
  })
}

/**
 * Compact timestamp for a message footer.
 *
 * - Same calendar day: just the time ("3:30 PM").
 * - Same year: month and day, no year ("Oct 29, 5:32 PM").
 * - Any other year: the date with its year, no time ("Oct 29, 2025"); the
 *   full timestamp is still in the footer's hover title.
 *
 * `now` is a parameter so the day and year boundaries are testable.
 */
export const formatMessageTime = (
  date: string | number | Date,
  now: Date = new Date()
): string => {
  const d = new Date(date)
  const time: Intl.DateTimeFormatOptions = {
    hour: 'numeric',
    minute: 'numeric',
    hour12: true,
  }
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString('en-US', time)
  }
  const sameYear = d.getFullYear() === now.getFullYear()
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? time : { year: 'numeric' }),
  })
}
