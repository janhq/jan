import { AppSidebar } from '@/components/sidebar/app-sidebar'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { NavHeader } from '@/components/sidebar/nav-header'

import ChatInput from '@/components/chat-input'
import { usePrivateChat } from './stores/private-chat-store'
import { HatGlassesIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { motion } from 'framer-motion'
import { SnowAnimation } from '@/components/snow-animation'

function AppPageContent() {
  const isPrivateChat = usePrivateChat((state) => state.isPrivateChat)

  return (
    <>
      <SnowAnimation />
      <AppSidebar />
      <SidebarInset>
        <NavHeader />
        <div className="flex flex-1 flex-col items-center justify-center h-full gap-4 px-4 py-10 max-w-3xl w-full mx-auto ">
          <div className="mx-auto flex justify-center items-center h-full w-full rounded-xl">
            <div className="w-full text-center">
              {isPrivateChat ? (
                <>
                  <div className="flex items-center justify-center mb-3">
                    <motion.div
                      initial={{ opacity: 0, scale: 0.5 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{
                        duration: 0.3,
                        delay: 0,
                        ease: [0, 0.71, 0.2, 1.01],
                      }}
                      className="bg-foreground size-10 rounded-full flex items-center justify-center"
                    >
                      <HatGlassesIcon className="text-background/80 size-6" />
                    </motion.div>
                    <motion.div
                      initial={{ opacity: 0, scale: 0.5 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{
                        duration: 0.3,
                        delay: 0.1,
                        ease: [0, 0.71, 0.2, 1.01],
                      }}
                      className="bg-foreground h-10 px-4 w-auto rounded-full flex items-center justify-center"
                    >
                      <span className="text-background/80 text-2xl font-medium">
                        private
                      </span>
                    </motion.div>
                    <motion.div
                      initial={{ opacity: 0, scale: 0.5 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{
                        duration: 0.3,
                        delay: 0.2,
                        ease: [0, 0.71, 0.2, 1.01],
                      }}
                      className="bg-foreground h-10 px-4 w-auto rounded-full flex items-center justify-center"
                    >
                      <span className="text-background/80 text-2xl font-medium">
                        chat
                      </span>
                    </motion.div>
                    <motion.div
                      initial={{ opacity: 0, scale: 0.5 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{
                        duration: 0.3,
                        delay: 0.3,
                        ease: [0, 0.71, 0.2, 1.01],
                      }}
                      className="bg-foreground h-10 px-4 w-auto rounded-full flex items-center justify-center"
                    >
                      <div className="flex items-center justify-center gap-1">
                        <motion.div
                          animate={{ y: [0, -3, 0] }}
                          transition={{
                            duration: 1,
                            repeat: Infinity,
                            ease: 'easeInOut',
                            delay: 0,
                          }}
                          className="size-3 bg-background/80 rounded-full"
                        />
                        <motion.div
                          animate={{ y: [0, -3, 0] }}
                          transition={{
                            duration: 1,
                            repeat: Infinity,
                            ease: 'easeInOut',
                            delay: 0.15,
                          }}
                          className="size-3 bg-background/80 rounded-full"
                        />
                        <motion.div
                          animate={{ y: [0, -3, 0] }}
                          transition={{
                            duration: 1,
                            repeat: Infinity,
                            ease: 'easeInOut',
                            delay: 0.3,
                          }}
                          className="size-3 bg-background/80 rounded-full"
                        />
                      </div>
                    </motion.div>
                  </div>
                  <motion.p
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, delay: 0.5 }}
                    className="w-full text-muted-foreground md:w-3/5 mx-auto mb-6"
                  >
                    This is a temporary chat. It won't be saved to your
                    conversation history, can't use memory, and will be deleted
                    when you close it.
                  </motion.p>
                </>
              ) : (
                <div className="flex items-center justify-center">
                  <motion.h2
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4 }}
                    className="text-2xl font-medium mb-6 font-studio"
                  >
                    How can I help you today?
                  </motion.h2>
                  <motion.div
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.5, delay: 0.2 }}
                    className="mb-6"
                  >
                    <img
                      src="/tree.png"
                      alt="Christmas tree"
                      className="size-10 object-contain"
                    />
                  </motion.div>
                </div>
              )}
              <ChatInput initialConversation={true} />
            </div>
          </div>
        </div>
      </SidebarInset>
    </>
  )
}

export default function AppPage() {
  const isPrivateChat = usePrivateChat((state) => state.isPrivateChat)

  return (
    <SidebarProvider
      className={cn(
        isPrivateChat &&
          '**:data-[slot="sidebar"]:opacity-0 **:data-[slot="sidebar"]:-translate-x-full **:data-[slot="sidebar-gap"]:w-0 **:data-[slot="sidebar"]:transition-all **:data-[slot="sidebar-gap"]:transition-all **:data-[slot="sidebar"]:duration-300 **:data-[slot="sidebar-gap"]:duration-300'
      )}
    >
      <AppPageContent />
    </SidebarProvider>
  )
}
