import {
  fs,
  Assistant,
  MessageRequest,
  events,
  InferenceEngine,
  MessageEvent,
  InferenceEvent,
  joinPath,
  executeOnMain,
  AssistantExtension,
  AssistantEvent,
} from '@janhq/core'

export default class JanAssistantExtension extends AssistantExtension {
  private static readonly _homeDir = 'file://assistants'
  private static readonly _threadDir = 'file://threads'

  controller = new AbortController()
  isCancelled = false
  retrievalThreadId: string | undefined = undefined

  async onLoad() {
    // making the assistant directory
    const assistantDirExist = await fs.existsSync(
      JanAssistantExtension._homeDir
    )
    if (
      localStorage.getItem(`${EXTENSION_NAME}-version`) !== VERSION ||
      !assistantDirExist
    ) {
      if (!assistantDirExist) await fs.mkdirSync(JanAssistantExtension._homeDir)

      // Write assistant metadata
      await this.createJanAssistant()
      // Finished migration
      localStorage.setItem(`${EXTENSION_NAME}-version`, VERSION)
      // Update the assistant list
      events.emit(AssistantEvent.OnAssistantsUpdate, {})
    }

    // Events subscription
    events.on(MessageEvent.OnMessageSent, (data: MessageRequest) =>
      JanAssistantExtension.handleMessageRequest(data, this)
    )

    events.on(InferenceEvent.OnInferenceStopped, () => {
      JanAssistantExtension.handleInferenceStopped(this)
    })
  }

  private static async handleInferenceStopped(instance: JanAssistantExtension) {
    instance.isCancelled = true
    instance.controller?.abort()
  }

  private static async handleMessageRequest(
    data: MessageRequest,
    instance: JanAssistantExtension
  ) {
    instance.isCancelled = false
    instance.controller = new AbortController()

    if (
      data.model?.engine !== InferenceEngine.tool_retrieval_enabled ||
      !data.messages ||
      // TODO: Since the engine is defined, its unsafe to assume that assistant tools are defined
      // That could lead to an issue where thread stuck at generating response
      !data.thread?.assistants[0]?.tools
    ) {
      return
    }

    const latestMessage = data.messages[data.messages.length - 1]

    // 1. Ingest the document if needed
    if (
      latestMessage &&
      latestMessage.content &&
      typeof latestMessage.content !== 'string' &&
      latestMessage.content.length > 1
    ) {
      const docFile = latestMessage.content[1]?.doc_url?.url
      if (docFile) {
        await executeOnMain(
          NODE,
          'toolRetrievalIngestNewDocument',
          docFile,
          data.model?.proxyEngine
        )
      }
    } else if (
      // Check whether we need to ingest document or not
      // Otherwise wrong context will be sent
      !(await fs.existsSync(
        await joinPath([
          JanAssistantExtension._threadDir,
          data.threadId,
          'memory',
        ])
      ))
    ) {
      // No document ingested, reroute the result to inference engine
      const output = {
        ...data,
        model: {
          ...data.model,
          engine: data.model.proxyEngine,
        },
      }
      events.emit(MessageEvent.OnMessageSent, output)
      return
    }
    // 2. Load agent on thread changed
    if (instance.retrievalThreadId !== data.threadId) {
      await executeOnMain(NODE, 'toolRetrievalLoadThreadMemory', data.threadId)

      instance.retrievalThreadId = data.threadId

      // Update the text splitter
      await executeOnMain(
        NODE,
        'toolRetrievalUpdateTextSplitter',
        data.thread.assistants[0].tools[0]?.settings?.chunk_size ?? 4000,
        data.thread.assistants[0].tools[0]?.settings?.chunk_overlap ?? 200
      )
    }

    // 3. Using the retrieval template with the result and query
    if (latestMessage.content) {
      const prompt =
        typeof latestMessage.content === 'string'
          ? latestMessage.content
          : latestMessage.content[0].text
      // Retrieve the result
      const retrievalResult = await executeOnMain(
        NODE,
        'toolRetrievalQueryResult',
        prompt
      )
      console.debug('toolRetrievalQueryResult', retrievalResult)

      // Update message content
      if (data.thread?.assistants[0]?.tools && retrievalResult)
        data.messages[data.messages.length - 1].content =
          data.thread.assistants[0].tools[0].settings?.retrieval_template
            ?.replace('{CONTEXT}', retrievalResult)
            .replace('{QUESTION}', prompt)
    }

    // Filter out all the messages that are not text
    data.messages = data.messages.map((message) => {
      if (
        message.content &&
        typeof message.content !== 'string' &&
        (message.content.length ?? 0) > 0
      ) {
        return {
          ...message,
          content: [message.content[0]],
        }
      }
      return message
    })

    // 4. Reroute the result to inference engine
    const output = {
      ...data,
      model: {
        ...data.model,
        engine: data.model.proxyEngine,
      },
    }
    events.emit(MessageEvent.OnMessageSent, output)
  }

  /**
   * Called when the extension is unloaded.
   */
  onUnload(): void {}

  async createAssistant(assistant: Assistant): Promise<void> {
    const assistantDir = await joinPath([
      JanAssistantExtension._homeDir,
      assistant.id,
    ])
    if (!(await fs.existsSync(assistantDir))) await fs.mkdirSync(assistantDir)

    // store the assistant metadata json
    const assistantMetadataPath = await joinPath([
      assistantDir,
      'assistant.json',
    ])
    try {
      await fs.writeFileSync(
        assistantMetadataPath,
        JSON.stringify(assistant, null, 2)
      )
    } catch (err) {
      console.error(err)
    }
  }

  async getAssistants(): Promise<Assistant[]> {
    // get all the assistant directories
    // get all the assistant metadata json
    const results: Assistant[] = []
    const allFileName: string[] = await fs.readdirSync(
      JanAssistantExtension._homeDir
    )
    for (const fileName of allFileName) {
      const filePath = await joinPath([
        JanAssistantExtension._homeDir,
        fileName,
      ])

      if (filePath.includes('.DS_Store')) continue
      const jsonFiles: string[] = (await fs.readdirSync(filePath)).filter(
        (file: string) => file === 'assistant.json'
      )

      if (jsonFiles.length !== 1) {
        // has more than one assistant file -> ignore
        continue
      }

      const content = await fs.readFileSync(
        await joinPath([filePath, jsonFiles[0]]),
        'utf-8'
      )
      const assistant: Assistant =
        typeof content === 'object' ? content : JSON.parse(content)

      results.push(assistant)
    }

    return results
  }

  async deleteAssistant(assistant: Assistant): Promise<void> {
    if (assistant.id === 'jan') {
      return Promise.reject('Cannot delete Jan Assistant')
    }

    // remove the directory
    const assistantDir = await joinPath([
      JanAssistantExtension._homeDir,
      assistant.id,
    ])
    await fs.rmdirSync(assistantDir)
    return Promise.resolve()
  }

  private async createJanAssistant(): Promise<void> {
    const janAssistant: Assistant = {
      avatar: '',
      thread_location: undefined,
      id: 'jan',
      object: 'assistant',
      created_at: Date.now(),
      name: 'Jan',
      description: 'A default assistant that can use all downloaded models',
      model: '*',
      instructions: '',
      tools: [
        {
          type: 'retrieval',
          enabled: false,
          settings: {
            top_k: 2,
            chunk_size: 1024,
            chunk_overlap: 64,
            retrieval_template: `Use the following pieces of context to answer the question at the end. If you don't know the answer, just say that you don't know, don't try to make up an answer.
----------------
CONTEXT: {CONTEXT}
----------------
QUESTION: {QUESTION}
----------------
Helpful Answer:`,
          },
        },
      ],
      file_ids: [],
      metadata: undefined,
    }

    await this.createAssistant(janAssistant)
  }
}
