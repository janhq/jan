import { useEffect, useMemo, useState } from 'react'

import { Message, TextContentBlock } from '@janhq/core'
import { useAtomValue } from 'jotai'

import { chunkCountAtom } from '@/helpers/atoms/ChatMessage.atom'

type Props = {
  message: Message
}

const TokenCount: React.FC<Props> = ({ message }) => {
  const chunkCountMap = useAtomValue(chunkCountAtom)
  const [lastTimestamp, setLastTimestamp] = useState<number | undefined>()
  const [tokenSpeed, setTokenSpeed] = useState(0)

  const receivedChunkCount = useMemo(
    () => chunkCountMap[message.id] ?? 0,
    [chunkCountMap, message.id]
  )

  useEffect(() => {
    if (message.status !== 'in_progress') {
      return
    }
    const currentTimestamp = Date.now()
    if (!lastTimestamp) {
      // If this is the first update, just set the lastTimestamp and return
      if (message.content && message.content.length > 0) {
        const messageContent = message.content[0]
        if (messageContent && messageContent.type === 'text') {
          const textContentBlock = messageContent as TextContentBlock
          if (textContentBlock.text.value !== '') {
            setLastTimestamp(currentTimestamp)
          }
        }
      }
      return
    }

    const timeDiffInSeconds = (currentTimestamp - lastTimestamp) / 1000
    const averageTokenSpeed = receivedChunkCount / timeDiffInSeconds

    setTokenSpeed(averageTokenSpeed)
  }, [message.content, lastTimestamp, receivedChunkCount, message.status])

  if (tokenSpeed === 0) return null

  return (
    <div className="absolute right-8 flex flex-row text-xs font-medium text-[hsla(var(--text-secondary))]">
      <p>
        Token count: {receivedChunkCount}, speed:{' '}
        {Number(tokenSpeed).toFixed(2)}t/s
      </p>
    </div>
  )
}

export default TokenCount
