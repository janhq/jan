/**
 * @jest-environment jsdom
 */
import { RemoteOAIEngine } from './'

class TestRemoteOAIEngine extends RemoteOAIEngine {
  inferenceUrl: string = ''
  provider: string = 'TestRemoteOAIEngine'
}

describe('RemoteOAIEngine', () => {
  let engine: TestRemoteOAIEngine

  beforeEach(() => {
    engine = new TestRemoteOAIEngine('', '')
  })

  test('should call onLoad and super.onLoad', () => {
    const onLoadSpy = jest.spyOn(engine, 'onLoad')
    const superOnLoadSpy = jest.spyOn(Object.getPrototypeOf(RemoteOAIEngine.prototype), 'onLoad')
    engine.onLoad()

    expect(onLoadSpy).toHaveBeenCalled()
    expect(superOnLoadSpy).toHaveBeenCalled()
  })

  test('should return headers with apiKey', async () => {
    engine.apiKey = 'test-api-key'
    const headers = await engine.headers()

    expect(headers).toEqual({
      'Authorization': 'Bearer test-api-key',
      'api-key': 'test-api-key',
    })
  })

  test('should return empty headers when apiKey is not set', async () => {
    engine.apiKey = undefined
    const headers = await engine.headers()

    expect(headers).toEqual({})
  })
})
