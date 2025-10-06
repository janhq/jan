/**
 * Shared error types for API responses
 */

export class ApiError extends Error {
  public readonly status: number
  public readonly statusText: string
  public readonly responseText: string

  constructor(status: number, statusText: string, responseText: string, message?: string) {
    super(message || `API request failed: ${status} ${statusText} - ${responseText}`)
    this.name = 'ApiError'
    this.status = status
    this.statusText = statusText
    this.responseText = responseText

    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if ((Error as any).captureStackTrace) {
      (Error as any).captureStackTrace(this, ApiError)
    }
  }

  /**
   * Check if this is a specific HTTP status code
   */
  isStatus(code: number): boolean {
    return this.status === code
  }

  /**
   * Check if this is a 404 Not Found error
   */
  isNotFound(): boolean {
    return this.status === 404
  }

  /**
   * Check if this is a client error (4xx)
   */
  isClientError(): boolean {
    return this.status >= 400 && this.status < 500
  }

  /**
   * Check if this is a server error (5xx)
   */
  isServerError(): boolean {
    return this.status >= 500 && this.status < 600
  }
}
