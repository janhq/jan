import { defineConfig, loadEnv, Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import { TanStackRouterVite } from '@tanstack/router-plugin/vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import packageJson from './package.json'
const host = process.env.TAURI_DEV_HOST

// Custom middleware plugin for proxying Anthropic API requests server-to-server.
// This avoids CORS issues by making the request from Node.js (the dev server)
// instead of from the browser. The browser talks to localhost (same-origin),
// and the dev server proxies to Anthropic's API with the bearer token.
function anthropicSubApiMiddleware(): Plugin {
  return {
    name: 'anthropic-sub-api-middleware',
    apply: 'serve',
    async configResolved() {},
    configureServer(server) {
      return () => {
        server.middlewares.use('/api/anthropic', async (req, res, next) => {
          if (req.method !== 'POST') {
            return next()
          }

          try {
            // Collect request body
            let body = ''
            await new Promise((resolve, reject) => {
              req.on('data', (chunk) => {
                body += chunk.toString()
              })
              req.on('end', resolve)
              req.on('error', reject)
            })

            let parsedBody: Record<string, unknown>
            try {
              parsedBody = JSON.parse(body)
            } catch {
              res.writeHead(400, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: 'Invalid JSON in request body' }))
              return
            }

            // Extract bearer token and base URL from request headers
            const authHeader = req.headers.authorization
            if (!authHeader || !authHeader.startsWith('Bearer ')) {
              res.writeHead(401, { 'Content-Type': 'application/json' })
              res.end(
                JSON.stringify({ error: 'Missing or invalid Authorization header' })
              )
              return
            }

            const bearerToken = authHeader.slice(7)
            const baseUrl = (req.headers['x-anthropic-base-url'] as string) ||
              'https://api.anthropic.com/v1'

            // Determine endpoint from request path
            const endpoint = req.url?.replace(/^\/api\/anthropic/, '') || '/messages'
            const anthropicUrl = `${baseUrl}${endpoint}`

            // Use the anthropic-beta value from the client request (which includes any
            // model-specific extras like 'effort-2025-11-24'), falling back to the base value.
            const anthropicBeta =
              (req.headers['anthropic-beta'] as string) || 'oauth-2025-04-20'

            // Make the request to Anthropic's API from Node.js (server-to-server, no CORS)
            const response = await fetch(anthropicUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${bearerToken}`,
                'anthropic-version': '2023-06-01',
                'anthropic-beta': anthropicBeta,
              },
              body: JSON.stringify(parsedBody),
            })

            // Stream Anthropic's response back to the client chunk by chunk.
            // Using response.text() would buffer the entire body before sending,
            // which breaks Server-Sent Events (SSE) streaming used by the AI SDK.
            const contentType = response.headers.get('content-type') || 'application/json'
            const responseHeaders: Record<string, string> = {
              'Content-Type': contentType,
            }
            if (contentType.includes('event-stream')) {
              responseHeaders['Cache-Control'] = 'no-cache'
              responseHeaders['Connection'] = 'keep-alive'
            }
            res.writeHead(response.status, responseHeaders)

            if (response.body) {
              const reader = response.body.getReader()
              try {
                while (true) {
                  const { done, value } = await reader.read()
                  if (done) break
                  res.write(value)
                }
              } finally {
                reader.releaseLock()
                res.end()
              }
            } else {
              res.end()
            }
          } catch (error) {
            console.error('Anthropic API middleware error:', error)
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(
              JSON.stringify({
                error: 'Failed to proxy request to Anthropic API',
              })
            )
          }
        })
      }
    },
  }
}

// Custom middleware plugin for proxying OpenAI (Sub) requests server-to-server.
// The OpenAI Responses API uses a different request/response format from the
// standard Chat Completions API that the AI SDK uses. This middleware:
//   1. Receives Chat Completions format from the browser
//   2. Transforms it into the Responses API format (input/instructions)
//   3. Forwards it to the configured endpoint with the bearer token
//   4. Transforms the Responses API SSE events back into Chat Completions SSE chunks
//   5. Streams the transformed response back to the browser
function openaiSubApiMiddleware(): Plugin {
  return {
    name: 'openai-sub-api-middleware',
    apply: 'serve',
    async configResolved() {},
    configureServer(server) {
      return () => {
        server.middlewares.use('/api/openai-sub', async (req, res, next) => {
          if (req.method !== 'POST') {
            return next()
          }

          try {
            // Collect request body
            let body = ''
            await new Promise((resolve, reject) => {
              req.on('data', (chunk) => {
                body += chunk.toString()
              })
              req.on('end', resolve)
              req.on('error', reject)
            })

            let parsedBody: Record<string, unknown>
            try {
              parsedBody = JSON.parse(body)
            } catch {
              res.writeHead(400, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: 'Invalid JSON in request body' }))
              return
            }

            // Extract bearer token from Authorization header
            const authHeader = req.headers.authorization
            if (!authHeader || !authHeader.startsWith('Bearer ')) {
              res.writeHead(401, { 'Content-Type': 'application/json' })
              res.end(
                JSON.stringify({ error: 'Missing or invalid Authorization header' })
              )
              return
            }

            const bearerToken = authHeader.slice(7)
            const endpoint =
              (req.headers['x-openai-sub-endpoint'] as string) ||
              'https://chatgpt.com/backend-api/codex/responses'

            // Transform Chat Completions format → Responses API format
            const messages =
              (parsedBody.messages as Array<{ role: string; content: unknown }>) ||
              []
            const systemMessage = messages.find((m) => m.role === 'system')
            const conversationMessages = messages.filter(
              (m) => m.role !== 'system'
            )

            const contentToString = (content: unknown): string => {
              if (typeof content === 'string') return content
              if (Array.isArray(content)) {
                return (content as Array<{ type: string; text?: string }>)
                  .filter((c) => c.type === 'text' && c.text)
                  .map((c) => c.text!)
                  .join('\n')
              }
              return String(content)
            }

            const normalizeContent = (
              content: unknown,
              role: string
            ): Array<{ type: string; text: string }> => {
              const contentType =
                role === 'assistant' ? 'output_text' : 'input_text'
              if (typeof content === 'string') {
                return [{ type: contentType, text: content }]
              }
              if (Array.isArray(content)) {
                return (content as Array<{ type: string; text?: string }>)
                  .filter((c) => c.type === 'text' && c.text)
                  .map((c) => ({ type: contentType, text: c.text! }))
              }
              return [{ type: contentType, text: String(content) }]
            }

            // Read reasoning params passed from the client via custom headers
            const reasoningEffort = req.headers['x-reasoning-effort'] as string | undefined
            const reasoningSystemAddition = req.headers['x-reasoning-system-addition'] as string | undefined

            const transformedBody: Record<string, unknown> = {
              model: parsedBody.model,
              store: false,
              stream: true,
              ...(reasoningEffort ? { reasoning: { effort: reasoningEffort } } : {}),
              input: conversationMessages.map((m) => ({
                type: 'message',
                role: m.role,
                content: normalizeContent(m.content, m.role),
              })),
            }

            // Build instructions, optionally prepending the reasoning system addition
            const baseInstructions = systemMessage
              ? contentToString(systemMessage.content)
              : undefined
            const instructions = reasoningSystemAddition
              ? baseInstructions
                ? `${reasoningSystemAddition}\n\n${baseInstructions}`
                : reasoningSystemAddition
              : baseInstructions
            if (instructions) {
              transformedBody.instructions = instructions
            }

            // Forward to the Responses API endpoint server-to-server (no CORS)
            const response = await fetch(endpoint, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${bearerToken}`,
              },
              body: JSON.stringify(transformedBody),
            })

            // Stream back as Chat Completions SSE
            res.writeHead(response.status, {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              'Connection': 'keep-alive',
            })

            if (response.body) {
              const reader = response.body.getReader()
              const decoder = new TextDecoder()
              const chatId = `chatcmpl-${Date.now()}`
              const created = Math.floor(Date.now() / 1000)
              const model = parsedBody.model as string
              let buffer = ''

              try {
                while (true) {
                  const { done, value } = await reader.read()
                  if (done) break

                  buffer += decoder.decode(value, { stream: true })
                  const lines = buffer.split('\n')
                  buffer = lines.pop() || ''

                  for (const line of lines) {
                    if (!line.trim() || !line.startsWith('data: ')) continue
                    const eventData = line.slice(6)
                    if (eventData === '[DONE]') continue

                    try {
                      const event = JSON.parse(eventData) as {
                        type: string
                        delta?: string
                      }

                      if (event.type === 'response.output_text.delta') {
                        const chunk = {
                          id: chatId,
                          object: 'chat.completion.chunk',
                          created,
                          model,
                          choices: [
                            {
                              index: 0,
                              delta: { content: event.delta },
                              finish_reason: null,
                            },
                          ],
                        }
                        res.write(`data: ${JSON.stringify(chunk)}\n\n`)
                      } else if (event.type === 'response.completed') {
                        const stopChunk = {
                          id: chatId,
                          object: 'chat.completion.chunk',
                          created,
                          model,
                          choices: [
                            { index: 0, delta: {}, finish_reason: 'stop' },
                          ],
                        }
                        res.write(`data: ${JSON.stringify(stopChunk)}\n\n`)
                        res.write('data: [DONE]\n\n')
                      }
                    } catch {
                      // Skip malformed events
                    }
                  }
                }
              } finally {
                reader.releaseLock()
                res.end()
              }
            } else {
              res.end()
            }
          } catch (error) {
            console.error('OpenAI Sub API middleware error:', error)
            if (!res.headersSent) {
              res.writeHead(500, { 'Content-Type': 'application/json' })
              res.end(
                JSON.stringify({
                  error: 'Failed to proxy request to OpenAI API',
                })
              )
            }
          }
        })
      }
    },
  }
}

// Plugin to inject GA scripts in HTML
function injectGoogleAnalytics(gaMeasurementId?: string): Plugin {
  return {
    name: 'inject-google-analytics',
    transformIndexHtml(html) {
      // Only inject GA scripts if GA_MEASUREMENT_ID is set
      if (!gaMeasurementId) {
        // Remove placeholder if no GA ID
        return html.replace(/\s*<!-- INJECT_GOOGLE_ANALYTICS -->\n?/g, '')
      }

      const gaScripts = `<!-- Google Analytics -->
    <script async src="https://www.googletagmanager.com/gtag/js?id=${gaMeasurementId}"></script>
    <script>
      window.dataLayer = window.dataLayer || [];
      function gtag(){ dataLayer.push(arguments); }
      gtag('consent','default',{
        ad_storage:'denied',
        analytics_storage:'denied',
        ad_user_data:'denied',
        ad_personalization:'denied',
        wait_for_update:500
      });
      gtag('js', new Date());
      gtag('config', '${gaMeasurementId}', {
        debug_mode: (location.hostname === 'localhost'),
        send_page_view: false
      });
    </script>`

      return html.replace('<!-- INJECT_GOOGLE_ANALYTICS -->', gaScripts)
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory.
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [
      TanStackRouterVite({
        target: 'react',
        autoCodeSplitting: true,
        routeFileIgnorePattern: '.((test).ts)|test-page',
      }),
      react(),
      tailwindcss(),
      nodePolyfills({
        include: ['path'],
      }),
      injectGoogleAnalytics(env.GA_MEASUREMENT_ID),
      anthropicSubApiMiddleware(),
      openaiSubApiMiddleware(),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        '@janhq/conversational-extension': path.resolve(__dirname, '../extensions/conversational-extension/src/index.ts'),
        '@janhq/core': path.resolve(__dirname, '../core/dist/index.js'),
      },
    },
    define: {
      IS_TAURI: JSON.stringify(process.env.IS_TAURI ?? false),
      IS_DEV: JSON.stringify(process.env.IS_DEV),
      IS_WEB_APP: JSON.stringify(true),
      IS_MACOS: JSON.stringify(false),
      IS_WINDOWS: JSON.stringify(false),
      IS_LINUX: JSON.stringify(false),
      IS_IOS: JSON.stringify(false),
      IS_ANDROID: JSON.stringify(false),
      PLATFORM: JSON.stringify('web'),

      VERSION: JSON.stringify(packageJson.version),

      POSTHOG_KEY: JSON.stringify(env.POSTHOG_KEY),
      POSTHOG_HOST: JSON.stringify(env.POSTHOG_HOST),
      GA_MEASUREMENT_ID: JSON.stringify(env.GA_MEASUREMENT_ID),
      MODEL_CATALOG_URL: JSON.stringify(
        'https://raw.githubusercontent.com/janhq/model-catalog/main/model_catalog_v2.json'
      ),
      AUTO_UPDATER_DISABLED: JSON.stringify(
        env.AUTO_UPDATER_DISABLED === 'true'
      ),
      UPDATE_CHECK_INTERVAL_MS: JSON.stringify(
        Number(env.UPDATE_CHECK_INTERVAL_MS) || 60 * 60 * 1000
      ),
    },

    clearScreen: false,
    server: {
      port: 1420,
      strictPort: false,
      host: host || false,
      hmr: host
        ? {
            protocol: 'ws',
            host,
            port: 1421,
          }
        : undefined,
      watch: {
        ignored: ['**/src-tauri/**'],
        usePolling: true
      },
    },
  }
})
