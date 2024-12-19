import {
  AssistantTool,
  executeOnMain,
  fs,
  InferenceTool,
  joinPath,
  MessageRequest,
} from '@janhq/core'

export class RetrievalTool extends InferenceTool {
  private _threadDir = 'file://threads'
  private retrievalThreadId: string | undefined = undefined

  name: string = 'retrieval'

  async process(
    data: MessageRequest,
    tool?: AssistantTool
  ): Promise<MessageRequest> {
    if (!data.model || !data.messages) {
      return Promise.resolve(data)
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
          data.thread?.id,
          docFile,
          data.model?.id,
          data.model?.engine,
          tool?.useTimeWeightedRetriever ?? false
        )
      } else {
        return Promise.resolve(data)
      }
    } else if (
      // Check whether we need to ingest document or not
      // Otherwise wrong context will be sent
      !(await fs.existsSync(
        await joinPath([this._threadDir, data.threadId, 'memory'])
      ))
    ) {
      // No document ingested, reroute the result to inference engine

      return Promise.resolve(data)
    }
    // 2. Load agent on thread changed
    if (this.retrievalThreadId !== data.threadId) {
      await executeOnMain(NODE, 'toolRetrievalLoadThreadMemory', data.threadId)

      this.retrievalThreadId = data.threadId

      // Update the text splitter
      await executeOnMain(
        NODE,
        'toolRetrievalUpdateTextSplitter',
        tool?.settings?.chunk_size ?? 4000,
        tool?.settings?.chunk_overlap ?? 200
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
        prompt,
        tool?.useTimeWeightedRetriever ?? false
      )
      console.debug('toolRetrievalQueryResult', retrievalResult)

      // Update message content
      if (retrievalResult)
        data.messages[data.messages.length - 1].content =
          tool?.settings?.retrieval_template
            ?.replace('{CONTEXT}', retrievalResult)
            .replace('{QUESTION}', prompt)
    }

    // 4. Reroute the result to inference engine
    return Promise.resolve(this.normalize(data))
  }

  // Filter out all the messages that are not text
  // TODO: Remove it until engines can handle multiple content types
  normalize(request: MessageRequest): MessageRequest {
    request.messages = request.messages?.map((message) => {
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
    return request
  }
}
