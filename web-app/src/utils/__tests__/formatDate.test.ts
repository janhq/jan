import { describe, it, expect } from 'vitest'
import { formatDate } from '../formatDate'

describe('formatDate', () => {
  it('formats Date objects correctly', () => {
    const date = new Date('2023-12-25T15:30:45Z')
    const formatted = formatDate(date)
    
    // The exact format depends on the system locale, but it should include key components
    expect(formatted).toMatch(/Dec.*25.*2023/i)
    expect(formatted).toMatch(/\d{1,2}:\d{2}/i) // time format
    expect(formatted).toMatch(/(AM|PM)/i)
  })

  it('formats ISO string dates correctly', () => {
    const isoString = '2023-01-15T09:45:30Z'
    const formatted = formatDate(isoString)
    
    expect(formatted).toMatch(/Jan.*15.*2023/i)
    expect(formatted).toMatch(/\d{1,2}:\d{2}/i)
    expect(formatted).toMatch(/(AM|PM)/i)
  })

  it('formats timestamp numbers correctly', () => {
    const timestamp = 1703519445000 // Dec 25, 2023 15:30:45 UTC
    const formatted = formatDate(timestamp)
    
    expect(formatted).toMatch(/Dec.*25.*2023/i)
    expect(formatted).toMatch(/\d{1,2}:\d{2}/i)
    expect(formatted).toMatch(/(AM|PM)/i)
  })

  it('handles different months correctly', () => {
    const dates = [
      '2023-01-01T12:00:00Z',
      '2023-02-01T12:00:00Z',
      '2023-03-01T12:00:00Z',
      '2023-12-01T12:00:00Z'
    ]
    
    const formatted = dates.map((d) => formatDate(d))
    
    expect(formatted[0]).toMatch(/Jan.*1.*2023/i)
    expect(formatted[1]).toMatch(/Feb.*1.*2023/i)
    expect(formatted[2]).toMatch(/Mar.*1.*2023/i)
    expect(formatted[3]).toMatch(/Dec.*1.*2023/i)
  })

  it('shows 12-hour format with AM/PM', () => {
    const morningDate = '2023-06-15T09:30:00Z'
    const eveningDate = '2023-06-15T21:30:00Z'
    
    const morningFormatted = formatDate(morningDate)
    const eveningFormatted = formatDate(eveningDate)
    
    // Note: The exact AM/PM depends on timezone, but both should have AM or PM
    expect(morningFormatted).toMatch(/(AM|PM)/i)
    expect(eveningFormatted).toMatch(/(AM|PM)/i)
  })

  it('handles edge cases', () => {
    // Test with very old and very new dates
    const oldDate = '1900-01-01T00:00:00Z'
    const futureDate = '2099-12-31T23:59:59Z'
    
    expect(() => formatDate(oldDate)).not.toThrow()
    expect(() => formatDate(futureDate)).not.toThrow()
    
    expect(formatDate(oldDate)).toMatch(/Jan.*1.*1900/i)
    // The futureDate might be affected by timezone - let's just check it doesn't throw
    const futureDateResult = formatDate(futureDate)
    expect(futureDateResult).toMatch(/\d{4}/) // Should contain a year
  })

  it('uses en-US locale formatting', () => {
    const date = '2023-07-04T12:00:00Z'
    const formatted = formatDate(date)
    
    // Should use US-style date formatting (Month Day, Year)
    expect(formatted).toMatch(/Jul.*4.*2023/i)
    // Should include abbreviated month name
    expect(formatted).toMatch(/Jul/i)
  })

  it('supports date-only formatting when includeTime=false', () => {
    const date = '2023-07-04T12:00:00Z'
    const formatted = formatDate(date, { includeTime: false })

    // Long month, no time
    expect(formatted).toMatch(/July.*4.*2023/i)
    expect(formatted).not.toMatch(/\d{1,2}:\d{2}/i)
    expect(formatted).not.toMatch(/(AM|PM)/i)
  })

  it('date-only formatting includes a year and omits time across edge cases', () => {
    const oldDate = '1900-01-01T00:00:00Z'
    const formatted = formatDate(oldDate, { includeTime: false })

    expect(formatted).toMatch(/\d{4}/)
    expect(formatted).not.toMatch(/\d{1,2}:\d{2}/i)
    expect(formatted).not.toMatch(/(AM|PM)/i)
  })
})
