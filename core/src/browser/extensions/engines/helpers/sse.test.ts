import { lastValueFrom, Observable } from 'rxjs'
import { requestInference } from './sse'

describe('requestInference', () => {
  it('should send a request to the inference server and return an Observable', () => {
    // Mock the fetch function
    const mockFetch: any = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ choices: [{ message: { content: 'Generated response' } }] }),
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
        json: () => Promise.resolve({ error: { message: 'Wrong API Key', code: 'invalid_api_key' } }),
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
    expect(lastValueFrom(result)).rejects.toEqual({ message: 'Wrong API Key', code: 'invalid_api_key' })
  })
})
