
import { ChatCompletionRole, MessageStatus } from '@janhq/core'

  import { ThreadMessageBuilder } from './threadMessageBuilder'
  import { MessageRequestBuilder } from './messageRequestBuilder'
  
import { ContentType } from '@janhq/core';
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

  it('testPushMessageWithPromptOnly', () => {
    const msgRequest = new MessageRequestBuilder(
      'type',
      { model: 'model' },
      { id: 'thread-id' },
      []
    );
    const builder = new ThreadMessageBuilder(msgRequest);
    const prompt = 'test prompt';
    builder.pushMessage(prompt, undefined, []);
    expect(builder.content).toEqual([
      {
        type: ContentType.Text,
        text: {
          value: prompt,
          annotations: [],
        },
      },
    ]);
  });


  it('testPushMessageWithPdf', () => {
    const msgRequest = new MessageRequestBuilder(
      'type',
      { model: 'model' },
      { id: 'thread-id' },
      []
    );
    const builder = new ThreadMessageBuilder(msgRequest);
    const prompt = 'test prompt';
    const base64 = 'test base64';
    const fileUpload = [{ type: 'pdf', file: { name: 'test.pdf', size: 1000 } }];
    builder.pushMessage(prompt, base64, fileUpload);
    expect(builder.content).toEqual([
      {
        type: ContentType.Pdf,
        text: {
          value: prompt,
          annotations: [base64],
          name: fileUpload[0].file.name,
          size: fileUpload[0].file.size,
        },
      },
    ]);
  });


  it('testPushMessageWithImage', () => {
    const msgRequest = new MessageRequestBuilder(
      'type',
      { model: 'model' },
      { id: 'thread-id' },
      []
    );
    const builder = new ThreadMessageBuilder(msgRequest);
    const prompt = 'test prompt';
    const base64 = 'test base64';
    const fileUpload = [{ type: 'image', file: { name: 'test.jpg', size: 1000 } }];
    builder.pushMessage(prompt, base64, fileUpload);
    expect(builder.content).toEqual([
      {
        type: ContentType.Image,
        text: {
          value: prompt,
          annotations: [base64],
        },
      },
    ]);
  });

