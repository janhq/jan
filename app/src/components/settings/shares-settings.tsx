import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { shareService } from '@/services/share-service'
import { toast } from 'sonner'
import { CopyIcon, CheckIcon, TrashIcon, Share2Icon } from 'lucide-react'

export function SharesSettings() {
  const [isLoading, setIsLoading] = useState(true)
  const [shares, setShares] = useState<ShareResponse[]>([])
  const [copiedShareId, setCopiedShareId] = useState<string | null>(null)

  useEffect(() => {
    loadShares()
  }, [])

  const loadShares = async () => {
    setIsLoading(true)
    try {
      const response = await shareService.listAllShares()
      // Filter out revoked shares
      setShares(response.data.filter((share) => !share.revoked_at))
    } catch (error) {
      console.error('Failed to load shares:', error)
      toast.error('Failed to load share links')
    } finally {
      setIsLoading(false)
    }
  }

  const getLocalShareUrl = (slug: string) => {
    return `${window.location.origin}/share/${slug}`
  }

  const handleCopyLink = async (slug: string, shareId: string) => {
    try {
      const localShareUrl = getLocalShareUrl(slug)
      await navigator.clipboard.writeText(localShareUrl)
      setCopiedShareId(shareId)
      toast.success('Link copied to clipboard')

      // Reset copied state after 2 seconds
      setTimeout(() => setCopiedShareId(null), 2000)
    } catch (error) {
      console.error('Failed to copy:', error)
      toast.error('Failed to copy link')
    }
  }

  const handleRevokeShare = async (shareId: string) => {
    try {
      await shareService.revokeShareById(shareId)
      setShares(shares.filter((s) => s.id !== shareId))
      toast.success('Share link revoked')
    } catch (error) {
      console.error('Failed to revoke share:', error)
      toast.error('Failed to revoke share link')
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div>
          <h3 className="text-lg font-semibold">Share Links</h3>
          <p className="text-sm text-muted-foreground">
            Manage all your shared conversation links
          </p>
        </div>

        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="rounded-lg border p-4">
              <div className="space-y-3">
                <div className="space-y-2">
                  <Skeleton className="h-5 w-3/4" />
                  <Skeleton className="h-4 w-32" />
                </div>
                <div className="flex items-center gap-2">
                  <Skeleton className="h-9 flex-1" />
                  <Skeleton className="h-9 w-9" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold">Share Links</h3>
        <p className="text-sm text-muted-foreground">
          Manage all your shared conversation links
        </p>
      </div>

      {shares.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-muted mb-4">
            <Share2Icon className="size-6 text-muted-foreground" />
          </div>
          <h4 className="text-base font-medium mb-1">No share links yet</h4>
          <p className="text-sm text-muted-foreground max-w-sm">
            Share links you create will appear here. Start sharing conversations
            from the chat interface.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {shares.map((share) => (
            <div key={share.id} className="flex gap-2 rounded-lg border p-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium wrap-break-word line-clamp-1">
                  {share.title || 'Untitled'}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {share.view_count} views
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1"
                  onClick={() => handleCopyLink(share.slug, share.id)}
                >
                  {copiedShareId === share.id ? (
                    <>
                      <CheckIcon className="size-4 " />
                      Copied
                    </>
                  ) : (
                    <>
                      <CopyIcon className="size-4 " />
                      Copy Link
                    </>
                  )}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleRevokeShare(share.id)}
                >
                  <TrashIcon className="size-4 text-destructive" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
