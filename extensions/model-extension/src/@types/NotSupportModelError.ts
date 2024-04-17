export class NotSupportedModelError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NotSupportedModelError'
  }
}
