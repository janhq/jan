import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useInterfaceSettings } from '@/hooks/useInterfaceSettings'
import { THREAD_SCROLL_BEHAVIOR } from '@/constants/threadScroll'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { IconCircleCheckFilled } from '@tabler/icons-react'

export function ThreadScrollBehaviorSwitcher() {
  const { threadScrollBehavior, setThreadScrollBehavior } = useInterfaceSettings()
  const { t } = useTranslation()

  const isFlowSelected = threadScrollBehavior === THREAD_SCROLL_BEHAVIOR.FLOW
  const isStickySelected = threadScrollBehavior === THREAD_SCROLL_BEHAVIOR.STICKY
  const placeholder = t('common:placeholder.chatInput')

  return (
    <div className="flex flex-col sm:flex-row sm:gap-4">
      <ScrollOption
        title={t('settings:interface.threadScrollFlowTitle')}
        hint={t('settings:interface.threadScrollFlowHint')}
        placeholder={placeholder}
        isSelected={isFlowSelected}
        onSelect={() => setThreadScrollBehavior(THREAD_SCROLL_BEHAVIOR.FLOW)}
        preview={<FlowScrollPreview placeholder={placeholder} />}
      />
      <ScrollOption
        title={t('settings:interface.threadScrollStickyTitle')}
        hint={t('settings:interface.threadScrollStickyHint')}
        placeholder={placeholder}
        isSelected={isStickySelected}
        onSelect={() => setThreadScrollBehavior(THREAD_SCROLL_BEHAVIOR.STICKY)}
        preview={<StickyScrollPreview placeholder={placeholder} />}
      />
    </div>
  )
}

type ScrollOptionProps = {
  title: string
  hint: string
  placeholder: string
  isSelected: boolean
  onSelect: () => void
  preview?: ReactNode
}

function ScrollOption({
  title,
  hint,
  placeholder,
  isSelected,
  onSelect,
  preview,
}: ScrollOptionProps) {
  return (
    <button
      className={cn(
        'w-full overflow-hidden border border-main-view-fg/10 rounded-md my-2 pb-2 cursor-pointer text-left transition-colors duration-200',
        isSelected && 'border-accent'
      )}
      onClick={onSelect}
      type="button"
    >
      <div className="flex items-center justify-between px-4 pt-3 pb-2 bg-main-view-fg/10 -mt-1">
        <span className="font-medium text-xs font-sans">{title}</span>
        {isSelected && (
          <IconCircleCheckFilled className="size-4 text-accent" />
        )}
      </div>
      <div className="px-6 py-5 space-y-2">
        {preview ?? (
          <>
            <div className="flex flex-col gap-2">
              <PlaceholderLine />
              <PlaceholderLine width="92%" />
              <PlaceholderLine width="76%" />
            </div>
            <div className="bg-main-view-fg/10 border border-main-view-fg/15 h-9 px-4 rounded-md flex items-center text-xs text-main-view-fg/55">
              <span className="line-clamp-1">{placeholder}</span>
            </div>
          </>
        )}
        <div className="text-[11px] text-main-view-fg/55 leading-snug border border-dashed border-main-view-fg/15 rounded-md px-3 py-2 bg-main-view-fg/7">
          {hint}
        </div>
      </div>
    </button>
  )
}

function PlaceholderLine({ width = '100%' }: { width?: string }) {
  return (
    <div className="h-2 rounded-full bg-main-view-fg/15" style={{ width }} />
  )
}

const FLOW_HISTORY_FRAMES = [
  { id: 'history-1', widths: ['82%', '68%', '46%'] },
  { id: 'history-2', widths: ['78%', '60%', '38%'] },
  { id: 'history-3', widths: ['70%', '52%'] },
] as const

const createFlowHistoryFrames = () =>
  Array.from(FLOW_HISTORY_FRAMES, (frame) => ({ ...frame }))

const FLOW_TYPING_TEXT = 'Jan, help me summarize this'
// Mirror Flow's history reveal timing so the typing cadence stays aligned.
const STICKY_USER_MESSAGE_DELAY =
  FLOW_HISTORY_FRAMES.length * 160 + 380
// Extend sticky preview loop so it resets in sync with Flow preview.
const STICKY_LOOP_ALIGNMENT_DELAY = 900

function FlowScrollPreview({ placeholder }: { placeholder: string }) {
  const [step, setStep] = useState(0)
  const [typedText, setTypedText] = useState('')
  const [sentMessage, setSentMessage] = useState('')
  const [streamProgress, setStreamProgress] = useState(0)
  const [historyMessages, setHistoryMessages] = useState<
    Array<{ id: string; widths: readonly string[] }>
  >(createFlowHistoryFrames)
  const [exitingHistoryIds, setExitingHistoryIds] = useState<string[]>([])
  const [userMessageVisible, setUserMessageVisible] = useState(false)
  const [streamStage, setStreamStage] = useState<'idle' | 'streaming' | 'complete'>('idle')

  const timersRef = useRef<number[]>([])
  const historyRef = useRef(historyMessages)

  useEffect(() => {
    historyRef.current = historyMessages
  }, [historyMessages])

  useEffect(() => {
    return () => {
      timersRef.current.forEach((timer) => clearTimeout(timer))
      timersRef.current = []
    }
  }, [])

  useEffect(() => {
    timersRef.current.forEach((timer) => clearTimeout(timer))
    timersRef.current = []

    if (step === 0) {
      setHistoryMessages(createFlowHistoryFrames())
      setExitingHistoryIds([])
      setTypedText('')
      setSentMessage('')
      setUserMessageVisible(false)
      setStreamStage('idle')
      setStreamProgress(0)

      const timer = window.setTimeout(() => setStep(1), 1200)
      timersRef.current.push(timer)
      return
    }

    if (step === 1) {
      setTypedText('')
      let index = 0
      const type = () => {
        index += 1
        setTypedText(FLOW_TYPING_TEXT.slice(0, index))
        if (index < FLOW_TYPING_TEXT.length) {
          const timer = window.setTimeout(type, 60)
          timersRef.current.push(timer)
        } else {
          const timer = window.setTimeout(() => setStep(2), 300)
          timersRef.current.push(timer)
        }
      }
      const start = window.setTimeout(type, 160)
      timersRef.current.push(start)
      return
    }

    if (step === 2) {
      const ids = historyRef.current.map((msg) => msg.id)
      if (ids.length === 0) {
        const timer = window.setTimeout(() => {
          setSentMessage(FLOW_TYPING_TEXT)
          setUserMessageVisible(true)
          setStep(3)
        }, 120)
        timersRef.current.push(timer)
        return
      }

      ids.forEach((id, index) => {
        const exitTimer = window.setTimeout(() => {
          setExitingHistoryIds((prev) =>
            prev.includes(id) ? prev : [...prev, id]
          )
        }, index * 160)
        timersRef.current.push(exitTimer)

        const removeTimer = window.setTimeout(() => {
          setHistoryMessages((prev) => prev.filter((msg) => msg.id !== id))
        }, index * 160 + 320)
        timersRef.current.push(removeTimer)
      })

      const revealDelay = ids.length * 160 + 380
      const revealTimer = window.setTimeout(() => {
        setSentMessage(FLOW_TYPING_TEXT)
        setUserMessageVisible(true)
        setExitingHistoryIds([])
        setStep(3)
      }, revealDelay)
      timersRef.current.push(revealTimer)
      return
    }

    if (step === 3) {
      setStreamStage('streaming')
      setStreamProgress(0)

      const tick = (value: number) => {
        setStreamProgress(value)
        if (value >= 100) {
          const timer = window.setTimeout(() => setStep(4), 400)
          timersRef.current.push(timer)
        } else {
          const timer = window.setTimeout(() => tick(value + 20), 140)
          timersRef.current.push(timer)
        }
      }

      const start = window.setTimeout(() => tick(20), 180)
      timersRef.current.push(start)
      return
    }

    if (step === 4) {
      setStreamStage('complete')
      const timer = window.setTimeout(() => setStep(0), 2200)
      timersRef.current.push(timer)
    }
  }, [step])

  const messageStack = useMemo(() => {
    const stack: ReactNode[] = []

    if (streamStage !== 'idle') {
      stack.unshift(
        <AssistantStreamBubble
          key="stream"
          progress={streamProgress}
          state={streamStage}
        />
      )
    }

    stack.unshift(
      <UserBubble
        key="user"
        text={sentMessage}
        visible={userMessageVisible}
      />
    )

    if (historyMessages.length > 0) {
      stack.push(
        <HistoryContainer key="history">
          {historyMessages.map((msg) => (
            <HistoryBubble
              key={msg.id}
              widths={msg.widths}
              exiting={exitingHistoryIds.includes(msg.id)}
            />
          ))}
        </HistoryContainer>
      )
    }

    return stack
  }, [
    exitingHistoryIds,
    historyMessages,
    sentMessage,
    streamProgress,
    streamStage,
    userMessageVisible,
  ])

  return (
    <div className="space-y-3 select-none">
      <div className="rounded-md border border-main-view-fg/10 bg-main-view-fg/5 p-3 h-[152px] overflow-hidden">
        <div className="flex h-full flex-col justify-start gap-2">
          {messageStack}
        </div>
      </div>
      <div className="bg-main-view-fg/10 border border-main-view-fg/15 h-9 px-4 rounded-md flex items-center text-xs text-main-view-fg/60 transition-all duration-500">
        {step === 1 ? (
          <div className="flex items-center gap-1 text-main-view-fg/80 font-medium truncate">
            <span className="truncate">{typedText}</span>
            <span className="inline-block w-[2px] h-4 bg-main-view-fg/60 animate-pulse" />
          </div>
        ) : (
          <span className="line-clamp-1">{placeholder}</span>
        )}
      </div>
    </div>
  )
}

function StickyScrollPreview({ placeholder }: { placeholder: string }) {
  const [step, setStep] = useState(0)
  const [typedText, setTypedText] = useState('')
  const [messages, setMessages] = useState<
    Array<{ id: string; type: 'assistant' | 'user'; widths: readonly string[] }>
  >(
    () =>
      createFlowHistoryFrames().map((frame) => ({
        ...frame,
        type: 'assistant' as const,
      }))
  )
  const [exitingIds, setExitingIds] = useState<string[]>([])
  const exitingIdsRef = useRef(exitingIds)
  const timersRef = useRef<number[]>([])
  const MAX_ASSISTANTS = FLOW_HISTORY_FRAMES.length

  useEffect(() => {
    exitingIdsRef.current = exitingIds
  }, [exitingIds])

  useEffect(() => {
    timersRef.current.forEach((timer) => clearTimeout(timer))
    timersRef.current = []

    if (step === 0) {
      setMessages(
        createFlowHistoryFrames().map((frame) => ({
          ...frame,
          type: 'assistant' as const,
        }))
      )
      setTypedText('')
      setExitingIds([])
      const timer = window.setTimeout(() => setStep(1), 1200)
      timersRef.current.push(timer)
      return
    }

    if (step === 1) {
      setTypedText('')
      let index = 0
      const type = () => {
        index += 1
        setTypedText(FLOW_TYPING_TEXT.slice(0, index))
        if (index < FLOW_TYPING_TEXT.length) {
          const t = window.setTimeout(type, 60)
          timersRef.current.push(t)
        } else {
          const t = window.setTimeout(() => setStep(2), 300)
          timersRef.current.push(t)
        }
      }
      const start = window.setTimeout(type, 160)
      timersRef.current.push(start)
      return
    }

    if (step === 2) {
      setMessages((prev) => {
        const alreadyHasUser = prev.some((msg) => msg.type === 'user')
        if (alreadyHasUser) return prev
        return [
          ...prev,
          {
            id: 'user-message',
            type: 'user',
            widths: [FLOW_TYPING_TEXT],
          },
        ]
      })

      const timer = window.setTimeout(() => setStep(3), STICKY_USER_MESSAGE_DELAY)
      timersRef.current.push(timer)
      return
    }

    if (step === 3) {
      const newAssistantMessages: Array<{ id: string; type: 'assistant'; widths: readonly string[] }> = [
        { id: 'assistant-stream-1', type: 'assistant', widths: ['64%', '52%', '36%'] },
        { id: 'assistant-stream-2', type: 'assistant', widths: ['58%', '40%'] },
        { id: 'assistant-stream-3', type: 'assistant', widths: ['62%', '53%', '42%', '24%'] },
      ]

      newAssistantMessages.forEach((message, index) => {
        const timer = window.setTimeout(() => {
          setMessages((prev) => {
            const updated = [...prev, message]

            const assistantCount = updated.filter(
              (item) => item.type === 'assistant'
            ).length

            if (assistantCount > MAX_ASSISTANTS) {
              const target = updated.find(
                (item) =>
                  item.type === 'assistant' &&
                  item.id !== message.id &&
                  !exitingIdsRef.current.includes(item.id)
              )

              if (target) {
                setExitingIds((current) =>
                  current.includes(target.id)
                    ? current
                    : [...current, target.id]
                )

                const removalTimer = window.setTimeout(() => {
                  setMessages((current) =>
                    current.filter((item) => item.id !== target.id)
                  )
                  setExitingIds((current) =>
                    current.filter((id) => id !== target.id)
                  )
                }, 260)

                timersRef.current.push(removalTimer)
              }
            }

            return updated
          })

          if (index === newAssistantMessages.length - 1) {
            const loopTimer = window.setTimeout(
              () => setStep(0),
              2000 + STICKY_LOOP_ALIGNMENT_DELAY
            )
            timersRef.current.push(loopTimer)
          }
        }, index * 220)
        timersRef.current.push(timer)
      })
    }
  }, [step, MAX_ASSISTANTS])

  useEffect(() => {
    return () => {
      timersRef.current.forEach((timer) => clearTimeout(timer))
      timersRef.current = []
    }
  }, [])

  return (
    <div className="space-y-3 select-none">
      <div className="rounded-md border border-main-view-fg/10 bg-main-view-fg/5 p-3 h-[152px] overflow-hidden">
        <div className="flex h-full flex-col justify-end gap-2">
          {messages.map((message) => {
          if (message.type === 'user') {
            return (
              <div
                key={message.id}
                className={cn(
                  'rounded-md border border-main-view-fg/20 bg-main-view px-3 py-2 text-xs font-medium text-main-view-fg shadow-sm transition-all duration-500',
                  typeof message.widths[0] === 'string' && message.widths[0] === FLOW_TYPING_TEXT
                    ? 'opacity-100 translate-y-0'
                    : 'opacity-80 translate-y-0'
                )}
              >
                {message.widths[0]}
              </div>
            )
          }

          return (
            <HistoryBubble
              key={message.id}
              widths={message.widths}
              exiting={exitingIds.includes(message.id)}
              collapse={false}
            />
          )
          })}
        </div>
      </div>
      <div className="bg-main-view-fg/10 border border-main-view-fg/15 h-9 px-4 rounded-md flex items-center text-xs text-main-view-fg/60 transition-all duration-500">
        {step === 1 ? (
          <div className="flex items-center gap-1 text-main-view-fg/80 font-medium truncate">
            <span className="truncate">{typedText}</span>
            <span className="inline-block w-[2px] h-4 bg-main-view-fg/60 animate-pulse" />
          </div>
        ) : (
          <span className="line-clamp-1">{placeholder}</span>
        )}
      </div>
    </div>
  )
}

function HistoryContainer({ children }: { children: ReactNode }) {
  return <>{children}</>
}

function HistoryBubble({
  widths,
  exiting,
  collapse = true,
}: {
  widths: readonly string[]
  exiting: boolean
  collapse?: boolean
}) {
  return (
    <div
      className={cn(
        'overflow-hidden rounded-md border border-main-view-fg/10 bg-main-view-fg/10 p-3 space-y-2 transition-all duration-500 ease-in-out',
        exiting &&
          (collapse
            ? 'max-h-0 opacity-0 -translate-y-3 p-0 border-transparent'
            : 'opacity-0')
      )}
    >
      {widths.map((width, idx) => (
        <div
          key={idx}
          className="h-2 rounded-full bg-main-view-fg/15"
          style={{ width }}
        />
      ))}
    </div>
  )
}

function UserBubble({ text, visible }: { text: string; visible: boolean }) {
  return (
    <div
      className={cn(
        'overflow-hidden rounded-md border border-main-view-fg/20 bg-main-view px-3 text-xs font-medium text-main-view-fg shadow-sm transition-all duration-500 ease-out',
        visible
          ? 'opacity-100 translate-y-0 max-h-[64px] py-2'
          : 'pointer-events-none opacity-0 -translate-y-3 max-h-0 py-0 border-transparent'
      )}
    >
      {text}
    </div>
  )
}

function AssistantStreamBubble({
  progress,
  state,
}: {
  progress: number
  state: 'idle' | 'streaming' | 'complete'
}) {
  const isVisible = state !== 'idle'
  const isComplete = state === 'complete'

  return (
    <div
      className={cn(
        'overflow-hidden rounded-md border border-main-view-fg/10 bg-main-view-fg/10 p-3 space-y-2 transition-all duration-500 ease-out',
        isVisible
          ? 'opacity-100 translate-y-0 max-h-[120px]'
          : 'pointer-events-none opacity-0 -translate-y-3 max-h-0 p-0 border-transparent'
      )}
    >
      <div className="h-2 rounded-full bg-main-view-fg/25 overflow-hidden">
        <div
          className="h-full rounded-full bg-main-view-fg/60 transition-all duration-200 ease-out"
          style={{ width: `${isComplete ? 100 : Math.min(progress, 100)}%` }}
        />
      </div>
      <div className="flex gap-2">
        <div className="h-2 w-20 rounded-full bg-main-view-fg/20" />
        <div className="h-2 w-16 rounded-full bg-main-view-fg/15" />
      </div>
      <div className="h-2 w-32 rounded-full bg-main-view-fg/15" />
    </div>
  )
}
