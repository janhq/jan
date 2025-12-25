import { HatGlassesIcon, XIcon, Share2Icon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/stores/auth-store'
import { useRouter } from '@tanstack/react-router'
import { usePrivateChat } from '@/stores/private-chat-store'
import { useChatSessions } from '@/stores/chat-session-store'
import { motion, AnimatePresence } from 'framer-motion'
import { ShareDialog } from '@/components/threads/share-dialog'
import { useState } from 'react'

interface NavActionsProps {
  conversationId?: string
  conversationTitle?: string
}

export function NavActions({
  conversationId,
  conversationTitle
}: NavActionsProps = {}) {
  const isAuthenticated = useAuth((state) => state.isAuthenticated)
  const isGuest = useAuth((state) => state.isGuest)
  const isPrivateChat = usePrivateChat((state) => state.isPrivateChat)
  const setIsPrivateChat = usePrivateChat((state) => state.setIsPrivateChat)
  const removeSession = useChatSessions((state) => state.removeSession)
  const router = useRouter()
  const [shareDialogOpen, setShareDialogOpen] = useState(false)

  const handleLogin = () => {
    // Add modal=login search param to current route
    const url = new URL(window.location.href)
    url.searchParams.set('modal', 'login')
    router.navigate({ to: url.pathname + url.search })
  }

  if (!isAuthenticated || isGuest) {
    return (
      <Button size="sm" onClick={handleLogin}>
        Log in
      </Button>
    )
  }

  return (
    <>
      <AnimatePresence>
        {isPrivateChat && (
          <motion.div
            initial={{ y: -100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -100, opacity: 0 }}
            transition={{ duration: 0.3, ease: 'easeInOut' }}
            className="
              hidden md:block fixed top-0 left-1/2 -translate-x-1/2 z-10
              h-12 bg-foreground
              rounded-2xl rounded-t-none
              pointer-events-none
  "
          >
            <div className="bg-foreground fixed size-4 -left-4 top-0">
              <div className="absolute top-0 left-0 w-4 h-4 bg-background rounded-tr-full" />
            </div>
            <div className="flex h-full items-center justify-center gap-2 px-4 text-background pointer-events-auto">
              <HatGlassesIcon className="size-4" />
              Private
            </div>
            <div className="bg-foreground fixed size-4 -right-4 top-0">
              <div className="absolute top-0 right-0 w-4 h-4 bg-background rounded-tl-full" />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Share button - only show for persistent conversations */}
      {conversationId && !isPrivateChat && (
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={() => setShareDialogOpen(true)}
        >
          <Share2Icon className="size-4 text-muted-foreground" />
        </Button>
      )}

      {isPrivateChat ? (
        <Button
          variant="destructive"
          className="rounded-full size-8 md:size-auto"
          onClick={() => {
            removeSession('private-chat')
            setIsPrivateChat(false)
            router.navigate({ to: '/' })
          }}
        >
          <span className="hidden md:flex">End Chat</span>
          <XIcon className="size-3.5" />
        </Button>
      ) : (
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={() => {
            setIsPrivateChat(true)
            router.navigate({ to: '/' })
          }}
        >
          <HatGlassesIcon className="text-muted-foreground" />
        </Button>
      )}

      {/* Share Dialog */}
      {conversationId && (
        <ShareDialog
          open={shareDialogOpen}
          onOpenChange={setShareDialogOpen}
          conversationId={conversationId}
          conversationTitle={conversationTitle}
        />
      )}
    </>
  )
}
