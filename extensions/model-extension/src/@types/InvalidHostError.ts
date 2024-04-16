export class InvalidHostError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidHostError'
  }
}
