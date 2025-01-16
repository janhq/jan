/**
 * Custom Engine Error
 */
export class EngineError extends Error {
  message: string
  constructor(message: string) {
    super()
    this.message = message
  }
}
