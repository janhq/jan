import { Observable } from 'rxjs'
import { EngineSettings } from '../@types/global'
import { Model } from '@janhq/core'

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
  model: Model,
  controller?: AbortController
): Observable<string> {
  return new Observable((subscriber) => {
    const text_input = recentMessages.map((message) => message.text).join('\n')
    const requestBody = JSON.stringify({
      text_input: text_input,
      max_tokens: 4096,
      temperature: 0,
      bad_words: '',
      stop_words: '[DONE]',
      stream: true,
    })
    fetch(`${engine.base_url}/v2/models/ensemble/generate_stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
        'Access-Control-Allow-Origin': '*',
      },
      body: requestBody,
      signal: controller?.signal,
    })
      .then(async (response) => {
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
              subscriber.next(content)
            }
          }
        }
        subscriber.complete()
      })
      .catch((err) => subscriber.error(err))
  })
}
