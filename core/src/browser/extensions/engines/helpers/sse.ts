import { Observable } from 'rxjs'
import { ErrorCode, ModelRuntimeParams } from '../../../../types'
/**
 * Sends a request to the inference server to generate a response based on the recent messages.
 * @param recentMessages - An array of recent messages to use as context for the inference.
 * @returns An Observable that emits the generated response as a string.
 */
export function requestInference(
  inferenceUrl: string,
  requestBody: any,
  model: {
    id: string
    parameters?: ModelRuntimeParams
  },
  controller?: AbortController,
  headers?: HeadersInit,
  transformResponse?: Function
): Observable<string> {
  return new Observable((subscriber) => {
    fetch(inferenceUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Accept': model.parameters?.stream
          ? 'text/event-stream'
          : 'application/json',
        ...headers,
      },
      body: JSON.stringify(requestBody),
      signal: controller?.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          if (response.status === 401) {
            throw {
              code: ErrorCode.InvalidApiKey,
              message: 'Invalid API Key.',
            }
          }
          let data = await response.json()
          try {
            handleError(data)
          } catch (err) {
            subscriber.error(err)
            return
          }
        }
        // There could be overriden stream parameter in the model
        // that is set in request body (transformed payload)
        if (
          requestBody?.stream === false ||
          model.parameters?.stream === false
        ) {
          const data = await response.json()
          try {
            handleError(data)
          } catch (err) {
            subscriber.error(err)
            return
          }
          if (transformResponse) {
            subscriber.next(transformResponse(data))
          } else {
            subscriber.next(
              data.choices
                ? data.choices[0]?.message?.content
                : (data.content[0]?.text ?? '')
            )
          }
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
            let cachedLines = ''
            for (const line of lines) {
              try {
                if (transformResponse) {
                  content += transformResponse(line)
                  subscriber.next(content ?? '')
                } else {
                  const toParse = cachedLines + line
                  if (!line.includes('data: [DONE]')) {
                    const data = JSON.parse(toParse.replace('data: ', ''))
                    try {
                      handleError(data)
                    } catch (err) {
                      subscriber.error(err)
                      return
                    }
                    content += data.choices[0]?.delta?.content ?? ''
                    if (content.startsWith('assistant: ')) {
                      content = content.replace('assistant: ', '')
                    }
                    if (content !== '') subscriber.next(content)
                  }
                }
              } catch {
                cachedLines = line
              }
            }
          }
        }
        subscriber.complete()
      })
      .catch((err) => subscriber.error(err))
  })
}

/**
 * Handle error and normalize it to a common format.
 * @param data
 */
const handleError = (data: any) => {
  if (
    data.error ||
    data.message ||
    data.detail ||
    (Array.isArray(data) && data.length && data[0].error)
  ) {
    throw data.error ?? data[0]?.error ?? data
  }
}
