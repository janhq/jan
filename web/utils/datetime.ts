export const isToday = (timestamp: number) => {
  const today = new Date()
  return (
    today.setHours(0, 0, 0, 0) ===
    new Date(timestamp * 1000).setHours(0, 0, 0, 0)
  )
}

export const displayDate = (timestamp?: string | number | Date) => {
  if (!timestamp) return 'N/A'

  const date =
    typeof timestamp === 'number'
      ? new Date(timestamp * 1000)
      : new Date(timestamp)

  let displayDate = `${date.toLocaleDateString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })}, ${date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  })}`

  if (typeof timestamp === 'number' && isToday(timestamp)) {
    displayDate = date.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    })
  }

  return displayDate
}
