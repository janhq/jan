export const PPLX_INTEGRATION_HEADER = 'X-Pplx-Integration'

const PPLX_INTEGRATION_SLUG = 'jan'

export function getPplxIntegrationHeaderValue(): string {
  return `${PPLX_INTEGRATION_SLUG}/${VERSION}`
}

export function getProviderDefaultHeaders(
  providerName: string
): Record<string, string> {
  if (providerName.toLowerCase() === 'openrouter') {
    return {
      'HTTP-Referer': 'https://jan.ai',
      'X-Title': 'Jan',
    }
  }

  if (providerName.toLowerCase() === 'perplexity') {
    return {
      [PPLX_INTEGRATION_HEADER]: getPplxIntegrationHeaderValue(),
    }
  }

  return {}
}
