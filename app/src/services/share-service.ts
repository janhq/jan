import { fetchJsonWithAuth } from '@/lib/api-client'

declare const JAN_API_BASE_URL: string

export const shareService = {
  /**
   * Create a share link for a conversation or single message
   */
  createShare: async (
    conversationId: string,
    request: CreateShareRequest
  ): Promise<ShareResponse> => {
    return fetchJsonWithAuth<ShareResponse>(
      `${JAN_API_BASE_URL}v1/conversations/${conversationId}/share?branch=MAIN`,
      {
        method: 'POST',
        body: JSON.stringify(request),
      }
    )
  },

  /**
   * List all shares (active and revoked) for a conversation
   */
  listShares: async (conversationId: string): Promise<ListSharesResponse> => {
    return fetchJsonWithAuth<ListSharesResponse>(
      `${JAN_API_BASE_URL}v1/conversations/${conversationId}/shares`
    )
  },

  /**
   * Revoke a share link
   */
  revokeShare: async (
    conversationId: string,
    shareId: string
  ): Promise<DeleteShareResponse> => {
    return fetchJsonWithAuth<DeleteShareResponse>(
      `${JAN_API_BASE_URL}v1/conversations/${conversationId}/shares/${shareId}`,
      {
        method: 'DELETE',
      }
    )
  },

  /**
   * Get a public share (no authentication required)
   */
  getPublicShare: async (slug: string): Promise<PublicShareResponse> => {
    const response = await fetch(
      `${JAN_API_BASE_URL}v1/public/shares/${slug}`
    )

    if (!response.ok) {
      if (response.status === 410) {
        throw new Error('This share has been revoked')
      }
      throw new Error('Failed to fetch share')
    }

    return response.json()
  },
}
