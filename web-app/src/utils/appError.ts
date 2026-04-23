export function normalizeAppError(error: unknown): string {
  if (typeof error === 'string') {
    return normalizeWhitespace(error)
  }

  if (error instanceof Error) {
    return normalizeWhitespace(error.message)
  }

  if (typeof error === 'object' && error !== null) {
    const record = error as { message?: unknown }

    if (typeof record.message === 'string') {
      return normalizeWhitespace(record.message)
    }

    try {
      return normalizeWhitespace(JSON.stringify(error))
    } catch {
      return 'Unknown error'
    }
  }

  return 'Unknown error'
}

function normalizeWhitespace(value: string): string {
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : 'Unknown error'
}
