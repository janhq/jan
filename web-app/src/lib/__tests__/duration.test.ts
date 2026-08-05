import { describe, expect, it } from 'vitest'
import { formatCompactDuration } from '../duration'

// Mirrors the compact unit strings in locales/en/common.json.
const t = (key: string, options?: Record<string, unknown>) => {
  const unit = { seconds: 's', minutes: 'm', hours: 'h' }[
    key.split('.')[1] as 'seconds' | 'minutes' | 'hours'
  ]
  return `${options?.count}${unit}`
}

const format = (seconds: number) => formatCompactDuration(seconds, t)

describe('formatCompactDuration', () => {
  it('renders sub-minute durations in seconds', () => {
    expect(format(0)).toBe('0s')
    expect(format(1)).toBe('1s')
    expect(format(59)).toBe('59s')
  })

  it('switches to minutes at 60 seconds', () => {
    expect(format(60)).toBe('1m')
    expect(format(90)).toBe('1m 30s')
    expect(format(3599)).toBe('59m 59s')
  })

  it('omits a zero remainder', () => {
    expect(format(120)).toBe('2m')
    expect(format(7200)).toBe('2h')
  })

  it('switches to hours at 3600 seconds', () => {
    expect(format(3600)).toBe('1h')
    expect(format(4800)).toBe('1h 20m')
  })

  it('drops seconds at hour scale to keep the label short', () => {
    expect(format(3661)).toBe('1h 1m')
  })

  it('floors fractional input and clamps negatives', () => {
    expect(format(1.9)).toBe('1s')
    expect(format(-5)).toBe('0s')
  })
})
