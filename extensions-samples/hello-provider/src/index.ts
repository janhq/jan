// A worker extension that touches every contribution point. Only types come
// from @janhq/extension-api: the bundle must import nothing at runtime, and
// everything the extension can do goes through `ctx`.
import type {
  CancellationToken,
  ExtensionContext,
  ProviderModel,
  ToolResult,
} from '@janhq/extension-api'

const STATUS_ITEM = 'hello.status'
const PROVIDER_BASE_URL = 'http://127.0.0.1:11999/v1'
const MAX_DELAY_MS = 10_000

const text = (value: string, isError?: boolean): ToolResult => ({
  content: [{ type: 'text', text: value }],
  ...(isError ? { isError } : {}),
})

interface EchoInput {
  text: string
  delayMs?: number
}

// The host validates nothing against inputSchema, so check here.
function parseEchoInput(input: unknown): EchoInput | undefined {
  if (typeof input !== 'object' || input === null) return undefined
  const { text: value, delayMs } = input as Record<string, unknown>
  if (typeof value !== 'string') return undefined
  if (delayMs === undefined) return { text: value }
  if (
    typeof delayMs !== 'number' ||
    !Number.isInteger(delayMs) ||
    delayMs < 0 ||
    delayMs > MAX_DELAY_MS
  )
    return undefined
  return { text: value, delayMs }
}

/** Resolves after `ms`, or with false as soon as `token` is cancelled. */
function delay(ms: number, token: CancellationToken): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      listener.dispose()
      resolve(true)
    }, ms)
    const listener = token.onCancellationRequested(() => {
      clearTimeout(timer)
      listener.dispose()
      resolve(false)
    })
  })
}

export async function activate(ctx: ExtensionContext): Promise<void> {
  let greeting = (await ctx.settings.get<string>('greeting')) ?? 'Hello'
  let count = 0
  const showStatus = () =>
    ctx.ui.setStatusItem(STATUS_ITEM, { text: `${greeting} (${count})` })

  ctx.subscriptions.add(
    ctx.settings.onDidChange(({ key, value }) => {
      if (key !== 'greeting' || typeof value !== 'string') return
      greeting = value
      showStatus()
    })
  )

  ctx.subscriptions.add(
    ctx.commands.registerCommand('hello.greet', () => {
      count += 1
      const message = `${greeting} from ${ctx.extension.displayName}!`
      ctx.ui.notify({ level: 'info', message })
      showStatus()
      return message
    })
  )

  // Any URL can be passed to show what the host refuses: only the granted
  // network:127.0.0.1 is reachable, and nothing in the worker can bypass
  // ctx.http (the prelude removed fetch and friends).
  ctx.subscriptions.add(
    ctx.commands.registerCommand('hello.ping', async (_context, url) => {
      const target =
        typeof url === 'string' ? url : `${PROVIDER_BASE_URL}/models`
      const response = await ctx.http.fetch(target)
      return response.status
    })
  )

  ctx.subscriptions.add(
    ctx.tools.registerTool('echo_upper', async (input, token) => {
      const parsed = parseEchoInput(input)
      if (!parsed)
        return text(
          'Expected { text: string, delayMs?: integer 0..10000 }',
          true
        )
      if (token.isCancellationRequested) return text('Cancelled', true)
      if (parsed.delayMs && !(await delay(parsed.delayMs, token))) {
        ctx.log.info('echo_upper cancelled')
        return text('Cancelled', true)
      }
      return text(parsed.text.toUpperCase())
    })
  )

  // The host runs inference against the declared baseUrl itself; the
  // extension only answers which models exist.
  ctx.subscriptions.add(
    ctx.providers.registerProvider('hello-local', {
      listModels: async (): Promise<ProviderModel[]> => [
        { id: 'hello-1', displayName: 'Hello 1' },
      ],
    })
  )

  showStatus()
}

export function deactivate(): void {
  // Everything lives in ctx.subscriptions, which the host disposes.
}
