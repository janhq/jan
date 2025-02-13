import { lastValueFrom, Observable } from 'rxjs'
import { requestInference } from './sse'

import { ReadableStream } from 'stream/web'
describe('requestInference', () => {
  it('should send a request to the inference server and return an Observable', () => {
    // Mock the fetch function
    const mockFetch: any = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            choices: [{ message: { content: 'Generated response' } }],
          }),
        headers: new Headers(),
        redirected: false,
        status: 200,
        statusText: 'OK',
        // Add other required properties here
      })
    )
    jest.spyOn(global, 'fetch').mockImplementation(mockFetch)

    // Define the test inputs
    const inferenceUrl = 'https://inference-server.com'
    const requestBody = { message: 'Hello' }
    const model = { id: 'model-id', parameters: { stream: false } }

    // Call the function
    const result = requestInference(inferenceUrl, requestBody, model)

    // Assert the expected behavior
    expect(result).toBeInstanceOf(Observable)
    expect(lastValueFrom(result)).resolves.toEqual('Generated response')
  })

  it('returns 401 error', () => {
    // Mock the fetch function
    const mockFetch: any = jest.fn(() =>
      Promise.resolve({
        ok: false,
        json: () =>
          Promise.resolve({
            error: { message: 'Invalid API Key.', code: 'invalid_api_key' },
          }),
        headers: new Headers(),
        redirected: false,
        status: 401,
        statusText: 'invalid_api_key',
        // Add other required properties here
      })
    )
    jest.spyOn(global, 'fetch').mockImplementation(mockFetch)

    // Define the test inputs
    const inferenceUrl = 'https://inference-server.com'
    const requestBody = { message: 'Hello' }
    const model = { id: 'model-id', parameters: { stream: false } }

    // Call the function
    const result = requestInference(inferenceUrl, requestBody, model)

    // Assert the expected behavior
    expect(result).toBeInstanceOf(Observable)
    expect(lastValueFrom(result)).rejects.toEqual({
      message: 'Invalid API Key.',
      code: 'invalid_api_key',
    })
  })
})

it('should handle a successful response with a transformResponse function', () => {
  // Mock the fetch function
  const mockFetch: any = jest.fn(() =>
    Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [{ message: { content: 'Generated response' } }],
        }),
      headers: new Headers(),
      redirected: false,
      status: 200,
      statusText: 'OK',
    })
  )
  jest.spyOn(global, 'fetch').mockImplementation(mockFetch)

  // Define the test inputs
  const inferenceUrl = 'https://inference-server.com'
  const requestBody = { message: 'Hello' }
  const model = { id: 'model-id', parameters: { stream: false } }
  const transformResponse = (data: any) =>
    data.choices[0].message.content.toUpperCase()

  // Call the function
  const result = requestInference(
    inferenceUrl,
    requestBody,
    model,
    undefined,
    undefined,
    transformResponse
  )

  // Assert the expected behavior
  expect(result).toBeInstanceOf(Observable)
  expect(lastValueFrom(result)).resolves.toEqual('GENERATED RESPONSE')
})

it('should handle a successful response with streaming enabled', () => {
  // Mock the fetch function
  const mockFetch: any = jest.fn(() =>
    Promise.resolve({
      ok: true,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              'data: {"choices": [{"delta": {"content": "Streamed"}}]}'
            )
          )
          controller.enqueue(new TextEncoder().encode('data: [DONE]'))
          controller.close()
        },
      }),
      headers: new Headers(),
      redirected: false,
      status: 200,
      statusText: 'OK',
    })
  )
  jest.spyOn(global, 'fetch').mockImplementation(mockFetch)

  // Define the test inputs
  const inferenceUrl = 'https://inference-server.com'
  const requestBody = { message: 'Hello' }
  const model = { id: 'model-id', parameters: { stream: true } }

  // Call the function
  const result = requestInference(inferenceUrl, requestBody, model)

  // Assert the expected behavior
  expect(result).toBeInstanceOf(Observable)
  expect(lastValueFrom(result)).resolves.toEqual('Streamed')
})
