import { it, expect } from 'vitest'
import * as engines from './index'

it('should re-export all exports from ./AIEngine', () => {
  expect(engines).toHaveProperty('AIEngine')
})
