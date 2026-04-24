export const THREAD_SCROLL_BEHAVIOR = {
  // FLOW: "chatgpt" behavior (keep viewport anchored to the latest user message)
  FLOW: 'flow',
  // STICKY: auto-follow streaming replies
  STICKY: 'sticky',
} as const

export type ThreadScrollBehavior =
  (typeof THREAD_SCROLL_BEHAVIOR)[keyof typeof THREAD_SCROLL_BEHAVIOR]

export const threadScrollBehaviorOptions: Array<{
  value: ThreadScrollBehavior
  translationKey: string
}> = [
  {
    value: THREAD_SCROLL_BEHAVIOR.FLOW,
    translationKey: 'settings:interface.threadScrollFlowTitle',
  },
  {
    value: THREAD_SCROLL_BEHAVIOR.STICKY,
    translationKey: 'settings:interface.threadScrollStickyTitle',
  },
]

