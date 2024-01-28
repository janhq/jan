import useSendChatMessage from '@/hooks/useSendChatMessage'

const MessageQueuedBanner: React.FC = () => {
  const { queuedMessage } = useSendChatMessage()

  return (
    <div>
      {queuedMessage && (
        <div className="my-2 py-2 text-center">
          <span className="rounded-lg border border-border px-4 py-2 shadow-lg">
            Message queued. It can be sent once the model has started
          </span>
        </div>
      )}
    </div>
  )
}

export default MessageQueuedBanner
