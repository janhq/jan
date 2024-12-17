import {
  ChatCompletionRole,
  MessageRequestType,
  MessageStatus,
} from '@janhq/core'

import { ThreadMessageBuilder } from './threadMessageBuilder'
import { MessageRequestBuilder } from './messageRequestBuilder'

import { ContentType } from '@janhq/core'
describe('ThreadMessageBuilder', () => {
  it('testBuildMethod', () => {
    const msgRequest = new MessageRequestBuilder(
      MessageRequestType.Thread,
      { model: 'model' } as any,
      { id: 'thread-id' } as any,
      []
    )
    const builder = new ThreadMessageBuilder(msgRequest)
    const result = builder.build()

    expect(result.id).toBe(msgRequest.msgId)
    expect(result.thread_id).toBe(msgRequest.thread.id)
    expect(result.role).toBe(ChatCompletionRole.User)
    expect(result.status).toBe(MessageStatus.Ready)
    expect(result.created_at).toBeDefined()
    expect(result.completed_at).toBeDefined()
    expect(result.object).toBe('thread.message')
    expect(result.content).toEqual([])
  })
})

it('testPushMessageWithPromptOnly', () => {
  const msgRequest = new MessageRequestBuilder(
    MessageRequestType.Thread,
    { model: 'model' } as any,
    { id: 'thread-id' } as any,
    []
  )
  const builder = new ThreadMessageBuilder(msgRequest)
  const prompt = 'test prompt'
  builder.pushMessage(prompt, undefined, undefined)
  expect(builder.content).toEqual([
    {
      type: ContentType.Text,
      text: {
        value: prompt,
        annotations: [],
      },
    },
  ])
})

it('testPushMessageWithPdf', () => {
  const msgRequest = new MessageRequestBuilder(
    MessageRequestType.Thread,
    { model: 'model' } as any,
    { id: 'thread-id' } as any,
    []
  )
  const builder = new ThreadMessageBuilder(msgRequest)
  const prompt = 'test prompt'
  const base64 = 'test base64'
  const fileUpload = [
    { type: 'pdf', file: { name: 'test.pdf', size: 1000 } },
  ] as any
  builder.pushMessage(prompt, base64, fileUpload)
  expect(builder.content).toEqual([
    {
      type: ContentType.Text,
      text: {
        value: prompt,
        annotations: [],
      },
    },
  ])
})

it('testPushMessageWithImage', () => {
  const msgRequest = new MessageRequestBuilder(
    MessageRequestType.Thread,
    { model: 'model' } as any,
    { id: 'thread-id' } as any,
    []
  )
  const builder = new ThreadMessageBuilder(msgRequest)
  const prompt = 'test prompt'
  const base64 = 'test base64'
  const fileUpload = [{ type: 'image', file: { name: 'test.jpg', size: 1000 } }]
  builder.pushMessage(prompt, base64, fileUpload as any)
  expect(builder.content).toEqual([
    {
      type: ContentType.Text,
      text: {
        value: prompt,
        annotations: [],
      },
    },
  ])
})
