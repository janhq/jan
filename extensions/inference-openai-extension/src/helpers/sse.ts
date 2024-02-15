import { Observable } from 'rxjs'

/**
 * Sends a request to the inference server to generate a response based on the recent messages.
 * @param recentMessages - An array of recent messages to use as context for the inference.
 * @param engine - The engine settings to use for the inference.
 * @param model - The model to use for the inference.
 * @returns An Observable that emits the generated response as a string.
 */
export function requestInference(
  recentMessages: any[],
  engine: EngineSettings,
  model: OpenAIModel,
  controller?: AbortController
): Observable<string> {
  return new Observable((subscriber) => {
    let model_id: string = model.id
    if (engine.full_url.includes(OPENAI_DOMAIN)) {
      model_id = engine.full_url.split('/')[5]
    }
    const requestBody = JSON.stringify({
      messages: recentMessages,
      stream: true,
      model: model_id,
      ...model.parameters,
    })
    fetch(`${engine.full_url}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': model.parameters.stream
          ? 'text/event-stream'
          : 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Authorization': `Bearer ${engine.api_key}`,
        'api-key': `${engine.api_key}`,
      },
      body: requestBody,
      signal: controller?.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          subscriber.next(
            (await response.json()).error?.message ?? 'Error occurred.'
          )
          subscriber.complete()
          return
        }
        if (model.parameters.stream === false) {
          const data = await response.json()
          subscriber.next(data.choices[0]?.message?.content ?? '')
        } else {
          const stream = response.body
          const decoder = new TextDecoder('utf-8')
          const reader = stream?.getReader()
          let content = ''

          while (true && reader) {
            const { done, value } = await reader.read()
            if (done) {
              break
            }
            const text = decoder.decode(value)
            const lines = text.trim().split('\n')
            for (const line of lines) {
              if (line.startsWith('data: ') && !line.includes('data: [DONE]')) {
                const data = JSON.parse(line.replace('data: ', ''))
                content += data.choices[0]?.delta?.content ?? ''
                if (content.startsWith('assistant: ')) {
                  content = content.replace('assistant: ', '')
                }
                subscriber.next(content)
              }
            }
          }
        }
        subscriber.complete()
      })
      .catch((err) => subscriber.error(err))
  })
}
