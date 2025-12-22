import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { shareService } from '@/services/share-service'
import { toast } from 'sonner'
import {
  CopyIcon,
  CheckIcon,
  Share2Icon,
  Loader2Icon,
  TrashIcon,
} from 'lucide-react'

interface ShareDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  conversationId: string
  conversationTitle?: string
}

export function ShareDialog({
  open,
  onOpenChange,
  conversationId,
  conversationTitle,
}: ShareDialogProps) {
  const [isCreating, setIsCreating] = useState(false)
  const [isLoadingShares, setIsLoadingShares] = useState(false)
  const [existingShares, setExistingShares] = useState<ShareResponse[]>([])
  const [copiedShareId, setCopiedShareId] = useState<string | null>(null)

  // Share options
  const [includeImages, setIncludeImages] = useState(true)
  const [customTitle, setCustomTitle] = useState('')

  // Load existing shares when dialog opens
  useEffect(() => {
    if (open && conversationId) {
      loadShares()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, conversationId])

  const loadShares = async () => {
    setIsLoadingShares(true)
    try {
      const response = await shareService.listShares(conversationId)
      // Filter out revoked shares for the UI
      setExistingShares(response.data.filter((share) => !share.revoked_at))
    } catch (error) {
      console.error('Failed to load shares:', error)
      // If sharing is disabled, we'll get a 403 - show info toast
      if (error instanceof Error && error.message.includes('403')) {
        toast.info('Conversation sharing is not enabled')
      }
    } finally {
      setIsLoadingShares(false)
    }
  }

  const getLocalShareUrl = (slug: string) => {
    // Convert slug to local share URL
    return `${window.location.origin}/share/${slug}`
  }

  const handleCreateShare = async () => {
    setIsCreating(true)
    try {
      const share = await shareService.createShare(conversationId, {
        scope: 'conversation',
        title: customTitle || conversationTitle,
        include_images: includeImages,
      })

      // Add to existing shares
      setExistingShares([share])

      // Copy to clipboard immediately using local URL
      const localShareUrl = getLocalShareUrl(share.slug)
      await navigator.clipboard.writeText(localShareUrl)
      toast.success('Share link created and copied to clipboard')

      // Reset form
      setCustomTitle('')
      setIncludeImages(true)
    } catch (error) {
      console.error('Failed to create share:', error)
      toast.error(
        error instanceof Error
          ? error.message
          : 'Failed to create share link. Please try again.'
      )
    } finally {
      setIsCreating(false)
    }
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
      await shareService.revokeShare(conversationId, shareId)
      setExistingShares(existingShares.filter((s) => s.id !== shareId))
      toast.success('Share link revoked')
    } catch (error) {
      console.error('Failed to revoke share:', error)
      toast.error('Failed to revoke share link')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Share Conversation</DialogTitle>
          <DialogDescription>
            Create a public link to share this conversation. Anyone with the
            link can view it.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Existing shares */}
          {isLoadingShares ? (
            <div className="flex items-center justify-center py-4">
              <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : existingShares.length > 0 ? (
            <div className="space-y-2">
              <Label className="text-sm font-medium">Active Shares</Label>
              {existingShares.map((share) => (
                <div
                  key={share.id}
                  className="flex flex-col gap-2 rounded-lg border p-3"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium break-words line-clamp-2">
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
                          <CheckIcon className="size-4 mr-2" />
                          Copied
                        </>
                      ) : (
                        <>
                          <CopyIcon className="size-4 mr-2" />
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
          ) : null}

          {/* Create new share */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">
              Create New Share Link
            </Label>

            <div className="space-y-2">
              <Label htmlFor="share-title" className="text-sm">
                Custom Title (optional)
              </Label>
              <input
                id="share-title"
                type="text"
                placeholder={conversationTitle || 'Conversation'}
                value={customTitle}
                onChange={(e) => setCustomTitle(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>

            <div className="flex items-center justify-between">
              <Label htmlFor="include-images" className="text-sm">
                Include images
              </Label>
              <Switch
                id="include-images"
                checked={includeImages}
                onCheckedChange={setIncludeImages}
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button onClick={handleCreateShare} disabled={isCreating}>
            {isCreating ? (
              <>
                <Loader2Icon className="size-4 animate-spin mr-2" />
                Creating...
              </>
            ) : (
              <>
                <Share2Icon className="size-4 mr-2" />
                Create Share Link
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
