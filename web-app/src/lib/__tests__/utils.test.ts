import { describe, it, expect, vi } from 'vitest'
import {
  getProviderLogo,
  getProviderTitle,
  getReadableLanguageName,
  toGigabytes,
  formatMegaBytes,
  formatDuration,
  getModelDisplayName,
} from '../utils'

describe('getProviderLogo', () => {
  it('returns correct logo paths for known providers', () => {
    expect(getProviderLogo('llamacpp')).toBe(
      '/images/model-provider/llamacpp.svg'
    )
    expect(getProviderLogo('anthropic')).toBe(
      '/images/model-provider/anthropic.svg'
    )
    expect(getProviderLogo('openai')).toBe('/images/model-provider/openai.svg')
    expect(getProviderLogo('gemini')).toBe('/images/model-provider/gemini.svg')
    expect(getProviderLogo('avian')).toBe('/images/model-provider/avian.svg')
  })

  it('returns undefined for unknown providers', () => {
    expect(getProviderLogo('unknown')).toBeUndefined()
    expect(getProviderLogo('')).toBeUndefined()
  })
})

describe('getProviderTitle', () => {
  it('returns formatted titles for special providers', () => {
    expect(getProviderTitle('llamacpp')).toBe('Llama.cpp')
    expect(getProviderTitle('openai')).toBe('OpenAI')
    expect(getProviderTitle('openrouter')).toBe('OpenRouter')
    expect(getProviderTitle('gemini')).toBe('Gemini')
  })

  it('capitalizes first letter for unknown providers', () => {
    expect(getProviderTitle('anthropic')).toBe('Anthropic')
    expect(getProviderTitle('mistral')).toBe('Mistral')
    expect(getProviderTitle('test')).toBe('Test')
  })

  it('handles empty strings', () => {
    expect(getProviderTitle('')).toBe('')
  })
})

describe('getReadableLanguageName', () => {
  it('returns full language names for known languages', () => {
    expect(getReadableLanguageName('js')).toBe('JavaScript')
    expect(getReadableLanguageName('ts')).toBe('TypeScript')
    expect(getReadableLanguageName('jsx')).toBe('React JSX')
    expect(getReadableLanguageName('py')).toBe('Python')
    expect(getReadableLanguageName('cpp')).toBe('C++')
    expect(getReadableLanguageName('yml')).toBe('YAML')
  })

  it('capitalizes first letter for unknown languages', () => {
    expect(getReadableLanguageName('rust')).toBe('Rust')
    expect(getReadableLanguageName('unknown')).toBe('Unknown')
    expect(getReadableLanguageName('test')).toBe('Test')
  })

  it('handles empty strings', () => {
    expect(getReadableLanguageName('')).toBe('')
  })
})

describe('toGigabytes', () => {
  it('returns empty string for falsy inputs', () => {
    expect(toGigabytes(0)).toBe('')
    expect(toGigabytes(null as unknown as number)).toBe('')
    expect(toGigabytes(undefined as unknown as number)).toBe('')
  })

  it('formats bytes correctly', () => {
    expect(toGigabytes(500)).toBe('500B')
    expect(toGigabytes(1000)).toBe('1000B')
  })

  it('formats kilobytes correctly', () => {
    expect(toGigabytes(1025)).toBe('1.00KB')
    expect(toGigabytes(2048)).toBe('2.00KB')
    expect(toGigabytes(1536)).toBe('1.50KB')
  })

  it('formats exactly 1024 bytes as bytes', () => {
    expect(toGigabytes(1024)).toBe('1024B')
  })

  it('formats megabytes correctly', () => {
    expect(toGigabytes(1024 ** 2 + 1)).toBe('1.00MB')
    expect(toGigabytes(1024 ** 2 * 2.5)).toBe('2.50MB')
  })

  it('formats exactly 1024^2 bytes as KB', () => {
    expect(toGigabytes(1024 ** 2)).toBe('1024.00KB')
  })

  it('formats gigabytes correctly', () => {
    expect(toGigabytes(1024 ** 3 + 1)).toBe('1.00GB')
    expect(toGigabytes(1024 ** 3 * 1.5)).toBe('1.50GB')
  })

  it('formats exactly 1024^3 bytes as MB', () => {
    expect(toGigabytes(1024 ** 3)).toBe('1024.00MB')
  })

  it('respects hideUnit option', () => {
    expect(toGigabytes(1025, { hideUnit: true })).toBe('1.00')
    expect(toGigabytes(1024 ** 2 + 1, { hideUnit: true })).toBe('1.00')
    expect(toGigabytes(500, { hideUnit: true })).toBe('500')
    expect(toGigabytes(1024, { hideUnit: true })).toBe('1024')
  })

  it('respects toFixed option', () => {
    expect(toGigabytes(1536, { toFixed: 1 })).toBe('1.5KB')
    expect(toGigabytes(1536, { toFixed: 3 })).toBe('1.500KB')
    expect(toGigabytes(1024 ** 2 * 1.5, { toFixed: 0 })).toBe('2MB')
  })
})

describe('formatMegaBytes', () => {
  it('formats values less than 1024 MB as GB', () => {
    expect(formatMegaBytes(512)).toBe('0.50 GB')
    expect(formatMegaBytes(1000)).toBe('0.98 GB')
    expect(formatMegaBytes(1023)).toBe('1.00 GB')
  })

  it('formats values 1024*1024 MB and above as TB', () => {
    expect(formatMegaBytes(1024 * 1024)).toBe('1.00 TB')
    expect(formatMegaBytes(1024 * 1024 * 2.5)).toBe('2.50 TB')
  })

  it('formats exactly 1024 MB as GB', () => {
    expect(formatMegaBytes(1024)).toBe('1.00 GB')
  })

  it('handles zero and small values', () => {
    expect(formatMegaBytes(0)).toBe('0.00 GB')
    expect(formatMegaBytes(1)).toBe('0.00 GB')
  })
})

describe('formatDuration', () => {
  it('formats milliseconds when duration is less than 1 second', () => {
    const start = Date.now()
    const end = start + 500
    expect(formatDuration(start, end)).toBe('500ms')
  })

  it('formats seconds when duration is less than 1 minute', () => {
    const start = Date.now()
    const end = start + 30000 // 30 seconds
    expect(formatDuration(start, end)).toBe('30s')
  })

  it('formats minutes and seconds when duration is less than 1 hour', () => {
    const start = Date.now()
    const end = start + 150000 // 2 minutes 30 seconds
    expect(formatDuration(start, end)).toBe('2m 30s')
  })

  it('formats hours, minutes and seconds when duration is less than 1 day', () => {
    const start = Date.now()
    const end = start + 7890000 // 2 hours 11 minutes 30 seconds
    expect(formatDuration(start, end)).toBe('2h 11m 30s')
  })

  it('formats days, hours, minutes and seconds for longer durations', () => {
    const start = Date.now()
    const end = start + 180000000 // 2 days 2 hours
    expect(formatDuration(start, end)).toBe('2d 2h 0m 0s')
  })

  it('uses current time when endTime is not provided', () => {
    vi.useFakeTimers()
    const now = new Date('2023-01-01T12:00:00Z').getTime()
    vi.setSystemTime(now)

    const start = now - 5000 // 5 seconds ago
    expect(formatDuration(start)).toBe('5s')

    vi.useRealTimers()
  })

  it('handles negative durations (future start time)', () => {
    const start = Date.now() + 1000 // 1 second in the future
    const end = Date.now()
    expect(formatDuration(start, end)).toBe(
      'Invalid duration (start time is in the future)'
    )
  })

  it('handles exact time boundaries', () => {
    const start = 0
    expect(formatDuration(start, 1000)).toBe('1s') // exactly 1 second
    expect(formatDuration(start, 60000)).toBe('1m 0s') // exactly 1 minute
    expect(formatDuration(start, 3600000)).toBe('1h 0m 0s') // exactly 1 hour
    expect(formatDuration(start, 86400000)).toBe('1d 0h 0m 0s') // exactly 1 day
  })
})

describe('getModelDisplayName', () => {
  it('returns displayName when it exists', () => {
    const model = {
      id: 'llama-3.2-1b-instruct-q4_k_m.gguf',
      displayName: 'My Custom Model',
    } as Model
    expect(getModelDisplayName(model)).toBe('My Custom Model')
  })

  it('returns model.id when displayName is undefined', () => {
    const model = {
      id: 'llama-3.2-1b-instruct-q4_k_m.gguf',
    } as Model
    expect(getModelDisplayName(model)).toBe('llama-3.2-1b-instruct-q4_k_m.gguf')
  })

  it('returns model.id when displayName is empty string', () => {
    const model = {
      id: 'llama-3.2-1b-instruct-q4_k_m.gguf',
      displayName: '',
    } as Model
    expect(getModelDisplayName(model)).toBe('llama-3.2-1b-instruct-q4_k_m.gguf')
  })

  it('returns model.id when displayName is null', () => {
    const model = {
      id: 'llama-3.2-1b-instruct-q4_k_m.gguf',
      displayName: null as any,
    } as Model
    expect(getModelDisplayName(model)).toBe('llama-3.2-1b-instruct-q4_k_m.gguf')
  })

  it('handles models with complex display names', () => {
    const model = {
      id: 'very-long-model-file-name-with-lots-of-details.gguf',
      displayName: 'Short Name 🤖',
    } as Model
    expect(getModelDisplayName(model)).toBe('Short Name 🤖')
  })

  it('handles models with special characters in displayName', () => {
    const model = {
      id: 'model.gguf',
      displayName: 'Model (Version 2.0) - Fine-tuned',
    } as Model
    expect(getModelDisplayName(model)).toBe('Model (Version 2.0) - Fine-tuned')
  })
})
