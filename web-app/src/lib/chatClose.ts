import type { Chat, UIMessage } from '@ai-sdk/react'

type Participant = { stop: () => void | Promise<void>; settle: () => Promise<void> }
const finalizers = new WeakMap<Chat<UIMessage>, Set<Promise<unknown>>>()
const participants = new Map<Chat<UIMessage>, Participant>()
let closing = false
export const isChatClosing = () => closing
export function resumeChatsAfterPreventedClose() { closing = false }

/** Retained Chat objects, not mounted routes, own these registrations. */
export function trackChat(chat: Chat<UIMessage>, pending: Set<Promise<unknown>>) {
  finalizers.set(chat, pending)
  const stopped = chat.stop.bind(chat)
  const settle = async () => {
    // SDK sets ready immediately BEFORE calling onFinish. Cross a microtask
    // before inspecting pending callbacks; status alone is not a barrier.
    for (;;) {
      await Promise.resolve()
      if (pending.size) {
        await Promise.all([...pending])
        continue
      }
      if (chat.status !== 'submitted' && chat.status !== 'streaming') return
      await new Promise<void>((resolve) => {
        const unsubscribe = chat['~registerStatusCallback'](() => {
          unsubscribe()
          resolve()
        })
      })
    }
  }
  participants.set(chat, { stop: stopped, settle })
  const guard = <A extends unknown[]>(original: (...args: A) => Promise<void>) => (...args: A) => {
    if (closing) return Promise.resolve()
    const operation = original(...args)
    pending.add(operation)
    void operation.then(() => pending.delete(operation), () => pending.delete(operation))
    return operation
  }
  chat.sendMessage = guard(chat.sendMessage.bind(chat))
  chat.regenerate = guard(chat.regenerate.bind(chat))
  chat.resumeStream = guard(chat.resumeStream.bind(chat))
}
export function observeChatWork<T>(pending: Set<Promise<unknown>>, work: () => T): T {
  const result = work()
  if (result && typeof (result as unknown as Promise<unknown>).then === 'function') {
    const promise = Promise.resolve(result)
    pending.add(promise)
    void promise.then(() => pending.delete(promise), () => { /* Keep failed finalization fail-closed. */ })
  }
  return result
}
export function trackChatFinalization(chat: Chat<UIMessage> | undefined, completion: Promise<unknown>) {
  const pending = chat && finalizers.get(chat)
  if (pending) observeChatWork(pending, () => completion)
}
export function setChatCloseStop(chat: Chat<UIMessage>, stop: () => void | Promise<void>) {
  const participant = participants.get(chat)
  if (participant) participant.stop = stop
}
export async function quiesceChats() {
  closing = true
  const snapshot = [...participants.values()]
  const stops = snapshot.map(async (p) => p.stop())
  const results = await Promise.allSettled([...stops, ...snapshot.map((p) => p.settle())])
  const failure = results.find((r) => r.status === 'rejected')
  if (failure?.status === 'rejected') throw failure.reason
}
export function forgetChat(chat: Chat<UIMessage>) { participants.delete(chat) }
export async function withChatCloseDeadline<T>(work: Promise<T>, timeoutMs = 10_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Chat close timed out; close again to retry')), timeoutMs)
    })])
  } finally { if (timer) clearTimeout(timer) }
}
export function __resetChatCloseForTests() { participants.clear(); closing = false }
