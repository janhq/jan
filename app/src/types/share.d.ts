// Share API Types
// Based on Share API Documentation

interface ShareOptions {
  include_images: boolean
  include_context_messages: boolean
}

interface ShareResponse {
  id: string
  object: 'share'
  slug: string
  share_url: string
  title: string | null
  item_id: string | null
  visibility: 'unlisted' | 'private' | 'public'
  view_count: number
  revoked_at: number | null
  last_viewed_at: number | null
  snapshot_version: number
  share_options: ShareOptions | null
  created_at: number
  updated_at: number
}

interface CreateShareRequest {
  scope: 'conversation' | 'item'
  item_id?: string
  title?: string
  include_images?: boolean
  include_context_messages?: boolean
}

interface ListSharesResponse {
  object: 'list'
  data: ShareResponse[]
}

interface DeleteShareResponse {
  id: string
  object: 'share.deleted'
  deleted: boolean
}

interface Snapshot {
  title: string
  model_name: string
  assistant_name: string
  created_at: number
  items: ConversationItem[]
}

interface PublicShareResponse {
  object: 'public_share'
  slug: string
  title: string
  created_at: number
  snapshot: Snapshot
}
