import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { UIMessage } from '@ai-sdk/react'
import type * as ProviderCaps from '@/lib/providerCaps'

// Capture every streamText({...}) call so we can inspect the messages each
// request carries.
const streamTextCalls: Array<Record<string, unknown>> = []
// The options each request's UI stream was built with (its onError).
const uiStreamOptions: Array<{ onError?: (error: unknown) => string }> = []

const h = vi.hoisted(() => ({
  disabledTools: [] as string[],
  servers: ['srv'] as string[],
  getRelevantTools: vi.fn(),
  getModelProps: vi.fn(),
  assistantParameters: null as Record<string, unknown> | null,
  providerId: 'azure',
  readAttachmentAsDataUrl: vi.fn(),
  serviceHub: null as unknown,
}))

const mcpService = {
  getTools: vi.fn(async () => []),
  getToolsForServers: vi.fn(async () => []),
  getServerSummaries: vi.fn(async () =>
    h.servers.map((name) => ({ name, capabilities: [], description: '' }))
  ),
}

h.serviceHub = {
  mcp: () => mcpService,
  rag: () => ({ getTools: async () => [] }),
  uploads: () => ({ readAttachmentAsDataUrl: h.readAttachmentAsDataUrl }),
}

vi.mock('ai', async () => {
  const actual = await vi.importActual<typeof import('ai')>('ai')
  return {
    ...actual,
    streamText: (args: Record<string, unknown>) => {
      streamTextCalls.push(args)
      return {
        toUIMessageStream: (options: { onError?: (error: unknown) => string }) =>
          uiStreamOptions.push(options) &&
          new ReadableStream({
            start(controller) {
              controller.close()
            },
          }),
      }
    },
  }
})

const provider = {
  provider: 'azure',
  active: true,
  api_key: 'k',
  models: [{ id: 'gpt', capabilities: ['tools'] }],
  settings: [] as Array<{ key: string; controller_props: { value: boolean } }>,
}
const selectedModel = { id: 'gpt', capabilities: ['tools'] }

// Translated errors show their key and values, so a test can tell them apart.
vi.mock('@/i18n/react-i18next-compat', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n/react-i18next-compat')>()),
  i18n: {
    t: (key: string, values?: Record<string, string>) =>
      values ? `${key} ${JSON.stringify(values)}` : key,
  },
}))

vi.mock('@/hooks/useServiceHub', () => ({
  useServiceStore: { getState: () => ({ serviceHub: h.serviceHub }) },
}))
vi.mock('@/hooks/useToolAvailable', () => ({
  useToolAvailable: {
    getState: () => ({ getDisabledTools: () => h.disabledTools }),
  },
}))
vi.mock('@/hooks/useModelProvider', () => ({
  useModelProvider: {
    getState: () => ({
      selectedModel,
      selectedProvider: h.providerId,
      getProviderByName: () => provider,
    }),
  },
}))
vi.mock('@/hooks/useAssistant', () => ({
  useAssistant: {
    getState: () => ({
      currentAssistant: h.assistantParameters
        ? { parameters: h.assistantParameters }
        : null,
    }),
  },
}))
vi.mock('@/hooks/useThreads', () => ({
  useThreads: { getState: () => ({ threads: {} }) },
}))
vi.mock('@/hooks/useAttachments', () => ({
  useAttachments: { getState: () => ({ enabled: false }) },
}))
vi.mock('@/hooks/useMCPServers', () => ({
  useMCPServers: {
    getState: () => ({ settings: { enableSmartToolRouting: true } }),
  },
}))
// Every getState() setter is a no-op; unknown reads (currentStreamThreadId)
// resolve to undefined.
vi.mock('@/hooks/useAppState', () => ({
  useAppState: {
    getState: () =>
      new Proxy(
        {},
        {
          get: () => () => undefined,
        }
      ),
  },
}))
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => []) }))
vi.mock('@janhq/tauri-plugin-llamacpp-api', () => ({
  getLoadedModels: vi.fn(async () => ['llama-local']),
  unloadLlamaModel: vi.fn(),
}))
vi.mock('@/lib/llamacppRouterProps', () => ({
  getLlamacppExtension: () => ({ getModelProps: h.getModelProps }),
}))
vi.mock('@/lib/mcp-orchestrator', () => ({
  mcpOrchestrator: { getRelevantTools: h.getRelevantTools },
}))
vi.mock('@/lib/mcp-router-model-filter', () => ({
  isRouterModelSelectable: () => false,
}))
vi.mock('@/lib/reasoningProviderOptions', () => ({
  buildReasoningProviderOptions: () => undefined,
}))
vi.mock('@/lib/providerCaps', async (importOriginal) => ({
  ...(await importOriginal<typeof ProviderCaps>()),
  isPredefinedRemoteProvider: () => false,
  getProviderApiType: () => 'openai',
}))
vi.mock('../model-factory', () => ({
  ModelFactory: { createModel: vi.fn(async () => ({ modelId: 'gpt' })) },
}))

import { APICallError } from 'ai'
import { CustomChatTransport } from '../custom-chat-transport'

const DATA_URL = 'data:application/pdf;base64,JVBERi0='

const userWithPdf = (): UIMessage =>
  ({
    id: 'u1',
    role: 'user',
    parts: [{ type: 'text', text: 'summarise the report' }],
    metadata: {
      native_files: [
        {
          name: 'report.pdf',
          path: 'D:/jan-data/attachments/01J/report.pdf',
          media_type: 'application/pdf',
        },
      ],
    },
  }) as UIMessage

async function drain(stream: ReadableStream): Promise<void> {
  const reader = stream.getReader()
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done } = await reader.read()
    if (done) break
  }
}

const send = async (messages: UIMessage[]) => {
  const transport = new CustomChatTransport('you are jan', 'thread-1')
  await drain(
    await transport.sendMessages({
      chatId: 'thread-1',
      messages,
      abortSignal: undefined,
      trigger: 'submit-message',
      messageId: undefined,
    })
  )
  return streamTextCalls[streamTextCalls.length - 1]
}

// A PDF sent as it is lives in Jan's data folder; the request reads it and
// hands it to the model as a file, which the Responses API reads itself.
describe('CustomChatTransport PDFs sent as they are', () => {
  beforeEach(() => {
    streamTextCalls.length = 0
    h.providerId = 'azure'
    provider.provider = 'azure'
    h.getRelevantTools.mockReset()
    h.getRelevantTools.mockResolvedValue([])
    h.readAttachmentAsDataUrl.mockReset()
    h.readAttachmentAsDataUrl.mockResolvedValue(DATA_URL)
  })

  it.each(['azure', 'openai'])('sends the PDF with the message (%s)', async (name) => {
    h.providerId = name
    provider.provider = name
    const original = userWithPdf()

    const call = await send([original])

    expect(h.readAttachmentAsDataUrl).toHaveBeenCalledWith(
      'D:/jan-data/attachments/01J/report.pdf',
      'application/pdf'
    )
    const content = (call.messages as Array<{ role: string; content: unknown }>)[0]
      .content as Array<Record<string, unknown>>
    expect(content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'text', text: 'summarise the report' }),
        expect.objectContaining({
          type: 'file',
          mediaType: 'application/pdf',
          filename: 'report.pdf',
        }),
      ])
    )
    // The thread's own message is left as it was.
    expect(original.parts).toHaveLength(1)
  })

  it('says which file can no longer be read', async () => {
    h.readAttachmentAsDataUrl.mockRejectedValue(new Error('404 Not Found'))

    await expect(send([userWithPdf()])).rejects.toThrow(
      'model-errors:attachedFileMissing'
    )
    await expect(send([userWithPdf()])).rejects.toThrow('report.pdf')
  })

  // Chat Completions providers reject non-image files, and nothing reads the
  // kept PDF for them.
  it('sends no file to a provider that cannot read PDFs', async () => {
    h.providerId = 'groq'
    provider.provider = 'groq'

    const call = await send([userWithPdf()])

    expect(h.readAttachmentAsDataUrl).not.toHaveBeenCalled()
    expect(JSON.stringify(call.messages)).not.toContain('application/pdf')
  })

  describe('when the model cannot read the PDF', () => {
    const rejection = () =>
      new APICallError({
        message:
          'The file you uploaded is badly formatted or corrupted. Please fix the file and try again.',
        url: 'https://example.openai.azure.com/openai/v1/responses',
        requestBodyValues: {},
        statusCode: 400,
        data: {
          error: {
            message:
              'The file you uploaded is badly formatted or corrupted. Please fix the file and try again.',
            param: 'input',
            code: 'invalid_file',
          },
        },
      })

    it("says so in the user's language, with the API's reason", async () => {
      await send([userWithPdf()])
      const message = uiStreamOptions[uiStreamOptions.length - 1].onError!(rejection())

      expect(message).toContain('model-errors:attachedFileRejected')
      expect(message).toContain('badly formatted or corrupted')
    })

    it('leaves the error as it is for a request without such a file', async () => {
      await send([
        { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hello' }] } as UIMessage,
      ])
      const message = uiStreamOptions[uiStreamOptions.length - 1].onError!(rejection())

      expect(message).not.toContain('model-errors:attachedFileRejected')
    })
  })
})
