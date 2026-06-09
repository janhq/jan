import { useMemo, useState } from 'react'
import { Loader2, Play, Square } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useModelProvider } from '@/hooks/useModelProvider'
import { getServiceHub } from '@/hooks/useServiceHub'
import { useStudioSettings } from '@/stores/studio-settings-store'
import { getProviderTitle } from '@/lib/utils'

const LOCAL_PROVIDER_API_KEY = 'jan'
import { cn } from '@/lib/utils'

type PlaygroundTarget = {
  provider: string
  baseUrl: string
  modelId: string
}

export function StudioPlayground() {
  const { providers } = useModelProvider()
  const sampler = useStudioSettings((state) => state.sampler)
  const [prompt, setPrompt] = useState(
    'Write a short haiku about local inference runtimes.'
  )
  const [systemPrompt, setSystemPrompt] = useState(
    'You are a concise assistant for developer experiments.'
  )
  const [selectedTargetKey, setSelectedTargetKey] = useState('')
  const [output, setOutput] = useState('')
  const [rawResponse, setRawResponse] = useState('')
  const [running, setRunning] = useState(false)
  const [abortController, setAbortController] =
    useState<AbortController | null>(null)

  const targets = useMemo(() => {
    const entries: Array<{
      key: string
      label: string
      target: PlaygroundTarget
    }> = []

    for (const provider of providers) {
      if (
        !provider.active ||
        !['llamacpp', 'mlx', 'vllm', 'ollama'].includes(provider.provider)
      ) {
        continue
      }

      for (const model of provider.models) {
        if (!provider.base_url) continue
        const key = `${provider.provider}:${model.id}`
        entries.push({
          key,
          label: `${getProviderTitle(provider.provider)} / ${model.displayName || model.id}`,
          target: {
            provider: provider.provider,
            baseUrl: provider.base_url,
            modelId: model.id,
          },
        })
      }
    }

    return entries
  }, [providers])

  const selectedTarget =
    targets.find((entry) => entry.key === selectedTargetKey)?.target ??
    targets[0]?.target

  const requestBody = useMemo(
    () => ({
      model: selectedTarget?.modelId,
      stream: sampler.stream,
      temperature: sampler.temperature,
      top_p: sampler.topP,
      top_k: sampler.topK,
      repeat_penalty: sampler.repeatPenalty,
      max_tokens: sampler.maxTokens,
      seed: sampler.seed >= 0 ? sampler.seed : undefined,
      response_format: sampler.jsonMode ? { type: 'json_object' } : undefined,
      messages: [
        ...(systemPrompt.trim()
          ? [{ role: 'system' as const, content: systemPrompt.trim() }]
          : []),
        { role: 'user' as const, content: prompt.trim() },
      ],
    }),
    [prompt, sampler, selectedTarget?.modelId, systemPrompt]
  )

  const runPlayground = async () => {
    if (!selectedTarget?.baseUrl || !selectedTarget.modelId) return

    const controller = new AbortController()
    setAbortController(controller)
    setRunning(true)
    setOutput('')
    setRawResponse('')

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Origin': 'tauri://localhost',
      'Authorization': `Bearer ${LOCAL_PROVIDER_API_KEY}`,
      'x-api-key': LOCAL_PROVIDER_API_KEY,
    }

    try {
      const fetchImpl = getServiceHub().providers().fetch()
      const response = await fetchImpl(
        `${selectedTarget.baseUrl.replace(/\/$/, '')}/chat/completions`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        }
      )

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(
          `${selectedTarget.provider} returned ${response.status}: ${errorText}`
        )
      }

      if (!sampler.stream) {
        const json = await response.json()
        setRawResponse(JSON.stringify(json, null, 2))
        const content = json?.choices?.[0]?.message?.content
        setOutput(typeof content === 'string' ? content : JSON.stringify(json))
        return
      }

      const reader = response.body?.getReader()
      if (!reader) {
        throw new Error('Streaming response had no body')
      }

      const decoder = new TextDecoder()
      let buffer = ''
      let streamed = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed.startsWith('data:')) continue
          const payload = trimmed.slice(5).trim()
          if (!payload || payload === '[DONE]') continue

          try {
            const chunk = JSON.parse(payload)
            const delta = chunk?.choices?.[0]?.delta?.content
            if (typeof delta === 'string') {
              streamed += delta
              setOutput(streamed)
            }
            setRawResponse((current) =>
              current ? `${current}\n${payload}` : payload
            )
          } catch {
            setRawResponse((current) =>
              current ? `${current}\n${payload}` : payload
            )
          }
        }
      }
    } catch (error) {
      if (controller.signal.aborted) {
        setOutput((current) => `${current}\n\n[stopped]`)
        return
      }
      const message =
        error instanceof Error ? error.message : 'Playground request failed'
      setOutput(message)
    } finally {
      setRunning(false)
      setAbortController(null)
    }
  }

  const stopPlayground = () => {
    abortController?.abort()
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
      <section className="space-y-4 rounded-lg border border-border/60 bg-card p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="font-studio text-base font-medium text-foreground">
              Inference playground
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Send raw OpenAI-compatible requests against active providers.
              Enable vLLM or Ollama under Settings → Model Providers first.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={() => void runPlayground()}
              disabled={running || !selectedTarget}
            >
              {running ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Play className="size-4" />
              )}
              Run
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={stopPlayground}
              disabled={!running}
            >
              <Square className="size-4" />
              Stop
            </Button>
          </div>
        </div>

        <label className="block space-y-2 text-sm">
          <span className="text-foreground">Target</span>
          <select
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none"
            value={selectedTargetKey || targets[0]?.key || ''}
            onChange={(event) => setSelectedTargetKey(event.target.value)}
          >
            {targets.length === 0 ? (
              <option value="">Connect a runtime first</option>
            ) : (
              targets.map((entry) => (
                <option key={entry.key} value={entry.key}>
                  {entry.label}
                </option>
              ))
            )}
          </select>
        </label>

        <label className="block space-y-2 text-sm">
          <span className="text-foreground">System prompt</span>
          <Input
            value={systemPrompt}
            onChange={(event) => setSystemPrompt(event.target.value)}
          />
        </label>

        <label className="block space-y-2 text-sm">
          <span className="text-foreground">Prompt</span>
          <Textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            rows={6}
          />
        </label>

        <div>
          <div className="text-xs font-medium uppercase text-muted-foreground">
            Output
          </div>
          <pre
            className={cn(
              'mt-2 min-h-48 overflow-x-auto rounded-md bg-foreground/5 p-3 text-sm text-foreground',
              !output && 'text-muted-foreground'
            )}
          >
            {output || 'Run a request to see streamed output here.'}
          </pre>
        </div>
      </section>

      <section className="rounded-lg border border-border/60 bg-card p-4">
        <h3 className="text-sm font-medium text-foreground">Request payload</h3>
        <pre className="mt-3 overflow-x-auto rounded-md bg-foreground/5 p-3 text-xs text-muted-foreground">
          {JSON.stringify(requestBody, null, 2)}
        </pre>

        <h3 className="mt-4 text-sm font-medium text-foreground">
          Raw response
        </h3>
        <pre className="mt-3 max-h-[420px] overflow-auto rounded-md bg-foreground/5 p-3 text-xs text-muted-foreground">
          {rawResponse || 'Streaming chunks and final JSON will appear here.'}
        </pre>
      </section>
    </div>
  )
}
