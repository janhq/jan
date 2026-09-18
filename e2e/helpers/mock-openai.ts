import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { AddressInfo } from 'node:net'

/**
 * A minimal OpenAI-compatible server, so the chat spec can exercise the real
 * send/stream/persist loop without a real model.
 *
 * The alternative -- driving llamacpp -- means a multi-gigabyte download, minutes
 * per run, and a different backend on every architecture. This is deterministic,
 * takes milliseconds, and is byte-identical on macOS, Linux and both Windows
 * targets. It deliberately does NOT cover llamacpp; that needs its own
 * platform-specific test.
 *
 * It works from Node because the request is put on the wire by Rust rather than
 * by the webview's own network stack -- the call is made from webview JS, but
 * getRuntimeFetch() hands it tauri-plugin-http's fetch
 * (web-app/src/lib/model-factory.ts), and providers/tauri.ts fetches the model
 * list the same way. So this sees an ordinary HTTP client -- no CORS, no
 * preflight -- and the capability set already allows http://*:*.
 *
 * The permissive CORS headers and the OPTIONS branch below are therefore not
 * needed by the suite. They are there so that pointing a browser-hosted dev
 * build at this server also works, which costs three headers and saves the
 * confusion of a preflight failing against a server that looks fine from Tauri.
 */

/** The model id the spec types into the Add Model combobox. */
export const MOCK_MODEL_ID = 'jan-e2e-mock'

/**
 * Prefixed onto the echoed prompt. The echo is the point: asserting the reply
 * contains prefix + the text that was typed proves the prompt travelled all the
 * way to the server and the response travelled all the way back, rather than
 * just proving that *some* text rendered.
 */
export const MOCK_REPLY_PREFIX = 'mock reply to: '

/**
 * What the non-streaming branch answers, which is the thread-title summarizer.
 * Plain ASCII words on purpose: cleanTitle()
 * (web-app/src/lib/thread-title-summarizer.ts) strips everything outside
 * [\p{L}\p{N}\s], caps at 10 words, and returns null under 2 characters -- so
 * punctuation here would silently change what the sidebar shows.
 */
export const MOCK_TITLE = 'Mock Thread Title'

export type MockOptions = {
  /**
   * What `GET /v1/models` advertises, and so what a spec types into Add Model.
   *
   * Worth overriding when a second spec configures a second provider: both
   * providers stay in the profile (nothing deletes the first), and the chat
   * model dropdown keys its option testid on the model id alone
   * (DropdownModelProvider.tsx), so two providers offering the same id put two
   * matching elements on the page and `model-option-<id>` stops identifying one.
   */
  modelId?: string
  /**
   * Milliseconds to wait between streamed chunks.
   *
   * The default of 0 flushes the whole reply as fast as the socket takes it,
   * which is what a spec asserting on the finished text wants. A spec that has
   * to act on a reply *while it is still streaming* -- pressing stop -- needs
   * the stream to outlive the round trip that clicks the button, and this is
   * the only knob that makes that deterministic rather than a race against
   * loopback.
   */
  chunkDelayMs?: number
}

export type MockOpenAI = {
  /** Feed this to the Add Provider dialog verbatim. */
  baseUrl: string
  /** What this instance advertises; echoes back `modelId`, or the default. */
  modelId: string
  /**
   * How long the server pauses between streamed chunks, from now on.
   *
   * Writable, and read fresh for every chunk, so one test can slow the stream
   * down and the next can put it back without standing up a second server on a
   * second port and reconfiguring a second provider to reach it. The stop test
   * is the only caller: everything else wants a reply that has already finished
   * by the time it is asserted on.
   */
  chunkDelayMs: number
  /**
   * The last user turn of every *streaming* completion asked for so far, oldest
   * first. Live -- read it again to see later requests.
   *
   * This is how a spec tells "the UI re-rendered something it already had" from
   * "the UI asked the model again", which is the whole of what Regenerate
   * claims to do and is invisible from the DOM: a regenerated reply to an
   * unchanged prompt is byte-identical to the one it replaced. Title-summarizer
   * calls are deliberately excluded -- they are not conversation turns, and
   * they fire on a schedule of their own.
   */
  streamedPrompts: string[]
  close: () => Promise<void>
}

type ChatMessage = {
  role?: string
  content?: unknown
}

/**
 * The last user turn, as plain text.
 *
 * `content` is a string on the simple path but an array of typed parts once the
 * AI SDK has anything structured to send, so handle both rather than assuming.
 */
function lastUserText(messages: ChatMessage[]): string {
  const lastUser = [...messages].reverse().find((m) => m.role === 'user')
  const content = lastUser?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        part && typeof part === 'object' && 'text' in part
          ? String((part as { text: unknown }).text)
          : ''
      )
      .join('')
  }
  return ''
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = ''
    req.setEncoding('utf8')
    req.on('data', (chunk) => (body += chunk))
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })
}

function sendJson(res: ServerResponse, status: number, payload: unknown) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
  })
  res.end(body)
}

const completionId = 'chatcmpl-jan-e2e'

/** Resolves after `ms`; used only to pace a deliberately slow stream. */
function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Stream the echo back as SSE, in several chunks.
 *
 * Several and not one: a single blob would pass even if the webview only ever
 * rendered a whole response, which is precisely the part of the pipeline worth
 * covering. The trailing usage-only chunk is what OpenAI emits under
 * stream_options.include_usage, which model-factory.ts sets (includeUsage: true).
 *
 * Bails out the moment the socket is gone. Two callers destroy it: the app,
 * when a spec presses stop (tauri-plugin-http aborts the request), and close()
 * below. Without the check a stopped stream goes on writing into a dead
 * response for the rest of its chunk budget, and with a chunkDelayMs set that
 * is long enough to outlive the test that pressed stop -- so the abort would
 * look like it worked while the server disagreed.
 */
async function streamCompletion(
  res: ServerResponse,
  reply: string,
  modelId: string,
  chunkDelay: () => number
) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  })

  const created = Math.floor(Date.now() / 1000)
  const gone = () => res.destroyed || res.writableEnded
  const chunk = (delta: Record<string, unknown>, finish: string | null) =>
    res.write(
      `data: ${JSON.stringify({
        id: completionId,
        object: 'chat.completion.chunk',
        created,
        model: modelId,
        choices: [{ index: 0, delta, finish_reason: finish }],
      })}\n\n`
    )

  chunk({ role: 'assistant', content: '' }, null)
  // Words, not characters: enough pieces to be a real stream, few enough to keep
  // the transcript readable when a run is being debugged with logLevel debug.
  for (const piece of reply.match(/\S+\s*/g) ?? [reply]) {
    if (gone()) return
    chunk({ content: piece }, null)
    const pause = chunkDelay()
    if (pause > 0) await sleep(pause)
  }
  if (gone()) return
  chunk({}, 'stop')

  res.write(
    `data: ${JSON.stringify({
      id: completionId,
      object: 'chat.completion.chunk',
      created,
      model: modelId,
      choices: [],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    })}\n\n`
  )
  res.write('data: [DONE]\n\n')
  res.end()
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  modelId: string,
  chunkDelay: () => number,
  streamedPrompts: string[]
) {
  const url = req.url ?? '/'

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    })
    res.end()
    return
  }

  // Asked for by useProviderModels -> providers/tauri.ts fetchModelsFromProvider,
  // which GETs `${base_url}/models` the moment the Add Model dialog opens. Answer
  // it or that dialog renders an error state instead of a model list.
  if (req.method === 'GET' && url.startsWith('/v1/models')) {
    sendJson(res, 200, {
      object: 'list',
      data: [
        {
          id: modelId,
          object: 'model',
          created: Math.floor(Date.now() / 1000),
          owned_by: 'jan-e2e',
        },
      ],
    })
    return
  }

  if (req.method === 'POST' && url.startsWith('/v1/chat/completions')) {
    const raw = await readBody(req)
    let body: { stream?: boolean; messages?: ChatMessage[] } = {}
    try {
      body = JSON.parse(raw)
    } catch {
      sendJson(res, 400, { error: { message: `unparseable body: ${raw}` } })
      return
    }

    // Chat always streams (streamText). The only non-streaming caller is the
    // thread-title summarizer, which goes through generateText -- so `stream`
    // is what tells the two apart, and the title must be fixed for the sidebar
    // assertion to be deterministic.
    if (!body.stream) {
      sendJson(res, 200, {
        id: completionId,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: modelId,
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: MOCK_TITLE },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      })
      return
    }

    const prompt = lastUserText(body.messages ?? [])
    // Recorded before the reply is written, so a spec that counts requests sees
    // this one even if the stream it opens is aborted halfway through.
    streamedPrompts.push(prompt)
    await streamCompletion(res, MOCK_REPLY_PREFIX + prompt, modelId, chunkDelay)
    return
  }

  // Loud on purpose. A silent 404 here surfaces much later as an empty message
  // bubble, and the path is the only clue about which call was missed.
  sendJson(res, 404, {
    error: { message: `jan e2e mock has no route for ${req.method} ${url}` },
  })
}

/**
 * Start the mock on a free loopback port.
 *
 * Port 0 rather than a fixed one so two runs -- or a run alongside a developer's
 * own server -- cannot collide; the caller reads the real port back off the
 * returned baseUrl.
 *
 * Start it in the spec's before() and close it in after(): an open listener keeps
 * the wdio worker's event loop alive and the run never exits.
 */
export function startMockOpenAI(
  options: MockOptions = {}
): Promise<MockOpenAI> {
  const modelId = options.modelId ?? MOCK_MODEL_ID
  const streamedPrompts: string[] = []
  // Held in one place the handle also points at, so assigning to
  // `mock.chunkDelayMs` mid-spec changes the next chunk rather than only the
  // next server.
  const state = { chunkDelayMs: options.chunkDelayMs ?? 0 }

  const server: Server = createServer((req, res) => {
    handle(
      req,
      res,
      modelId,
      () => state.chunkDelayMs,
      streamedPrompts
    ).catch((error) => {
      if (res.headersSent) {
        res.end()
        return
      }
      sendJson(res, 500, { error: { message: String(error) } })
    })
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      resolve({
        baseUrl: `http://127.0.0.1:${port}/v1`,
        modelId,
        streamedPrompts,
        get chunkDelayMs() {
          return state.chunkDelayMs
        },
        set chunkDelayMs(ms: number) {
          state.chunkDelayMs = ms
        },
        close: () =>
          new Promise<void>((done, fail) => {
            // closeAllConnections() first: close() only stops new connections and
            // waits for live ones, and tauri-plugin-http keeps its sockets alive,
            // so without this the callback never fires and the worker hangs.
            server.closeAllConnections()
            server.close((error) => (error ? fail(error) : done()))
          }),
      })
    })
  })
}
