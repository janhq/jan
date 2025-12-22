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
import { InputGroup, InputGroupInput } from '@/components/ui/input-group'
import { Skeleton } from '@/components/ui/skeleton'
import { shareService } from '@/services/share-service'
import { toast } from 'sonner'
import { CopyIcon, CheckIcon, Loader2Icon, TrashIcon } from 'lucide-react'
import { Separator } from '@/components/ui/separator'

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

      // Reload shares from server to get the latest data
      await loadShares()
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
          {/* Create new share */}
          <div className="space-y-3">
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

            <div className="space-y-2">
              <Label htmlFor="share-title" className="text-sm">
                Custom Title (optional)
              </Label>
              <InputGroup>
                <InputGroupInput
                  id="share-title"
                  type="text"
                  placeholder={conversationTitle || 'Conversation'}
                  value={customTitle}
                  onChange={(e) => setCustomTitle(e.target.value)}
                  autoComplete="off"
                />
              </InputGroup>
            </div>
          </div>

          {/* Existing shares */}
          {isLoadingShares ? (
            <>
              <Separator />
              <div className="space-y-2">
                <Skeleton className="h-5 w-32" />
                <div className="flex gap-2 rounded-lg border p-3">
                  <div className="flex-1 min-w-0 space-y-2">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-3 w-16" />
                  </div>
                  <div className="flex items-center gap-2">
                    <Skeleton className="h-8 w-24" />
                    <Skeleton className="h-8 w-8" />
                  </div>
                </div>
              </div>
            </>
          ) : existingShares.length > 0 ? (
            <>
              <Separator />
              <div className="space-y-2">
                <Label className="text-sm font-medium">Active Shares</Label>
                {existingShares.map((share) => (
                  <div
                    key={share.id}
                    className="flex gap-2 rounded-lg border p-3"
                  >
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
            </>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            className="rounded-full"
          >
            Cancel
          </Button>
          <Button
            onClick={handleCreateShare}
            disabled={isCreating}
            className="rounded-full"
          >
            {isCreating ? (
              <>
                <Loader2Icon className="size-4 animate-spin mr-2" />
                Creating...
              </>
            ) : (
              <>Create Share Link</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
