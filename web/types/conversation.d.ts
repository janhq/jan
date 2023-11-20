export type ThreadState = {
  hasMore: boolean
  waitingForResponse: boolean
  error?: Error
  lastMessage?: string
}
