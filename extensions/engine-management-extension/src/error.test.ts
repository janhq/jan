import { describe, it, expect } from 'vitest'
import { EngineError } from './error'

describe('EngineError', () => {
  it('should create an error with the correct message', () => {
    const errorMessage = 'Test error message'
    const error = new EngineError(errorMessage)
    
    expect(error).toBeInstanceOf(Error)
    expect(error.message).toBe(errorMessage)
    expect(error.name).toBe('EngineError')
  })

  it('should create an error with default message if none provided', () => {
    const error = new EngineError()
    
    expect(error.message).toBe('Engine error occurred')
  })
})