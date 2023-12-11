import React, { forwardRef } from 'react'

import { ThreadMessage } from '@janhq/core'

import SimpleTextMessage from '../SimpleTextMessage'

type Ref = HTMLDivElement

const ChatItem = forwardRef<Ref, ThreadMessage>((message, ref) => (
  <div ref={ref} className="relative py-4">
    <SimpleTextMessage {...message} />
  </div>
))

export default ChatItem
