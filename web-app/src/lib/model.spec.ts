import { expect, test } from 'vitest'
import { normalizeProvider } from './models'

test('provider name should be normalized', () => {
  expect(normalizeProvider('llama.cpp')).toBe('cortex')
})
