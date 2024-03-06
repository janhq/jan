import { ErrorCode } from '@janhq/core'

export const getErrorTitle = (
  errorCode: ErrorCode,
  errorMessage: string | undefined
) => {
  switch (errorCode) {
    case ErrorCode.Unknown:
      return 'Apologies, something’s amiss!'
    case ErrorCode.InvalidApiKey:
      return 'Invalid API key. Please check your API key and try again.'
    default:
      return errorMessage
  }
}
