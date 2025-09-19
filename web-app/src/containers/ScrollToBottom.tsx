import { useThreadScrolling } from '@/hooks/useThreadScrolling'
import { memo } from 'react'
import { GenerateResponseButton } from './GenerateResponseButton'
import { useMessages } from '@/hooks/useMessages'
import { useShallow } from 'zustand/react/shallow'
import { useAppearance } from '@/hooks/useAppearance'
import { cn } from '@/lib/utils'
import { ArrowDown } from 'lucide-react'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useAppState } from '@/hooks/useAppState'

const ScrollToBottom = ({
  threadId,
  scrollContainerRef,
}: {
  threadId: string
  scrollContainerRef: React.RefObject<HTMLDivElement | null>
}) => {
  const { t } = useTranslation()
  const appMainViewBgColor = useAppearance((state) => state.appMainViewBgColor)
  const { showScrollToBottomBtn, scrollToBottom, setIsUserScrolling } =
    useThreadScrolling(threadId, scrollContainerRef)
  const { messages } = useMessages(
    useShallow((state) => ({
      messages: state.messages[threadId],
    }))
  )

  const streamingContent = useAppState((state) => state.streamingContent)

  const showGenerateAIResponseBtn =
    (messages[messages.length - 1]?.role === 'user' ||
      (messages[messages.length - 1]?.metadata &&
        'tool_calls' in (messages[messages.length - 1].metadata ?? {}))) &&
    !streamingContent

  return (
    <div
      className={cn(
        'absolute z-0 -top-6 h-8 py-1 flex w-full justify-center pointer-events-none opacity-0 visibility-hidden',
        appMainViewBgColor.a === 1
          ? 'from-main-view/20 bg-gradient-to-b to-main-view backdrop-blur'
          : 'bg-transparent',
        (showScrollToBottomBtn || showGenerateAIResponseBtn) &&
          'visibility-visible opacity-100'
      )}
    >
      {showScrollToBottomBtn && (
        <div
          className="bg-main-view-fg/10 px-2 border border-main-view-fg/5 flex items-center justify-center rounded-xl gap-x-2 cursor-pointer pointer-events-auto"
          onClick={() => {
            scrollToBottom(true)
            setIsUserScrolling(false)
          }}
        >
          <p className="text-xs">{t('scrollToBottom')}</p>
          <ArrowDown size={12} />
        </div>
      )}
      {showGenerateAIResponseBtn && (
        <GenerateResponseButton threadId={threadId} />
      )}
    </div>
  )
}

export default memo(ScrollToBottom)
