
import { ChatCompletionRole, MessageStatus } from '@janhq/core'

  import { ThreadMessageBuilder } from './threadMessageBuilder'
  import { MessageRequestBuilder } from './messageRequestBuilder'
  
  describe('ThreadMessageBuilder', () => {
    it('testBuildMethod', () => {
      const msgRequest = new MessageRequestBuilder(
        'type',
        { model: 'model' },
        { id: 'thread-id' },
        []
      )
      const builder = new ThreadMessageBuilder(msgRequest)
      const result = builder.build()
  
      expect(result.id).toBe(msgRequest.msgId)
      expect(result.thread_id).toBe(msgRequest.thread.id)
      expect(result.role).toBe(ChatCompletionRole.User)
      expect(result.status).toBe(MessageStatus.Ready)
      expect(result.created).toBeDefined()
      expect(result.updated).toBeDefined()
      expect(result.object).toBe('thread.message')
      expect(result.content).toEqual([])
    })
  })
