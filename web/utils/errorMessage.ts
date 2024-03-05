import { ErrorCode } from '@janhq/core'

export const getErrorTitle = (errorCode: ErrorCode) => {
  if (errorCode === ErrorCode.Unknown) {
    return 'Apologies, something’s amiss!'
  }

  if (errorCode === ErrorCode.InvalidApiKey) {
    return 'Invalid API key. Please check your API key and try again.'
  }
}
