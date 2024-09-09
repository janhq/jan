import { utilizedMemory } from './memory'

test('test_utilizedMemory_arbitraryValues', () => {
  const result = utilizedMemory(30, 100)
  expect(result).toBe(70)
})

test('test_utilizedMemory_freeEqualsTotal', () => {
  const result = utilizedMemory(100, 100)
  expect(result).toBe(0)
})
