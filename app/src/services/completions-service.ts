import { fetchJsonWithAuth } from '@/lib/api-client'

declare const JAN_API_BASE_URL: string

export const completionsService = {
  completions: async (payload: ChatCompletionRequest): Promise<unknown> => {
    return fetchJsonWithAuth<Conversation>(
      `${JAN_API_BASE_URL}v1/chat/completions`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    )
  },
}
