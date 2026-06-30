import { createFileRoute } from '@tanstack/react-router'
import { useMemo, useState, useCallback } from 'react'
import { streamText } from 'ai'
import { ModelFactory } from '@/lib/model-factory'
import { useModelProvider } from '@/hooks/useModelProvider'
import HeaderPage from '@/containers/HeaderPage'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import {
  IconSend,
  IconLoader2,
  IconColumns,
  IconAlertTriangle,
  IconBolt,
} from '@tabler/icons-react'

export const Route = createFileRoute('/compare')({
  component: ComparePage,
})

type ColumnKey = string // `${provider}::${modelId}`

type ColumnState = {
  provider: string
  modelId: string
  label: string
  text: string
  reasoning?: string // streamed reasoning_content, for thinking models
  done: boolean
  error?: string
  // generation stats
  ttftMs?: number // time to first token
  totalMs?: number // request start → done
  tps?: number // output tokens / second (live while streaming, exact on done)
  outputTokens?: number
  totalTokens?: number
  tokensApprox?: boolean // true when token count is estimated (no provider usage)
}

const keyOf = (provider: string, modelId: string): ColumnKey =>
  `${provider}::${modelId}`

const fmtMs = (ms: number): string =>
  ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`

type RunMode = 'by-backend' | 'parallel' | 'sequential'

const RUN_MODES: { key: RunMode; label: string; hint: string }[] = [
  {
    key: 'by-backend',
    label: 'By backend',
    hint: 'Run backends in parallel, but one model at a time within each backend. Best for local servers (LM Studio, llama.cpp) that serialize generation and would otherwise drop a column.',
  },
  {
    key: 'parallel',
    label: 'Concurrent',
    hint: 'Fire every model at once. Fastest, but a single local backend may return an empty column for the queued request.',
  },
  {
    key: 'sequential',
    label: 'Sequential',
    hint: 'Run one model at a time, in order. Slowest, but safest for any backend.',
  },
]

function ComparePage() {
  const { providers } = useModelProvider()
  const [prompt, setPrompt] = useState('')
  const [selected, setSelected] = useState<Set<ColumnKey>>(new Set())
  const [columns, setColumns] = useState<ColumnState[]>([])
  const [running, setRunning] = useState(false)
  const [mode, setMode] = useState<RunMode>('by-backend')

  // Flat list of selectable models across all active providers.
  const options = useMemo(() => {
    const out: { key: ColumnKey; provider: string; modelId: string; label: string }[] = []
    for (const p of providers) {
      if (p.active === false) continue
      for (const m of p.models ?? []) {
        if (m.embedding) continue
        const modelId = m.id
        out.push({
          key: keyOf(p.provider, modelId),
          provider: p.provider,
          modelId,
          label: `${m.name || m.id}`,
        })
      }
    }
    return out
  }, [providers])

  const toggle = useCallback((key: ColumnKey) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const updateColumn = useCallback(
    (key: ColumnKey, patch: Partial<ColumnState>) => {
      setColumns((cols) =>
        cols.map((c) => (keyOf(c.provider, c.modelId) === key ? { ...c, ...patch } : c))
      )
    },
    []
  )

  const runOne = useCallback(
    async (o: { key: ColumnKey; provider: string; modelId: string }, userPrompt: string) => {
      const key = o.key
      try {
        const provider = providers.find((p) => p.provider === o.provider)
        if (!provider) throw new Error(`Provider "${o.provider}" not found`)
        const model = await ModelFactory.createModel(o.modelId, provider, {})
        const t0 = performance.now()
        let firstAt: number | null = null
        const result = streamText({
          model,
          messages: [{ role: 'user', content: userPrompt }],
        })
        let acc = ''
        let reasoningAcc = ''
        // fullStream surfaces reasoning_content too, so thinking models
        // (which return empty `content`) aren't rendered blank.
        for await (const part of result.fullStream) {
          if (part.type === 'text-delta' || part.type === 'reasoning-delta') {
            const now = performance.now()
            if (firstAt === null) firstAt = now
            if (part.type === 'text-delta') acc += part.text
            else reasoningAcc += part.text
            // live decode estimate over all emitted tokens (text + reasoning)
            const liveTokens = Math.max(1, Math.round((acc.length + reasoningAcc.length) / 4))
            const genSec = (now - firstAt) / 1000
            updateColumn(key, {
              text: acc,
              reasoning: reasoningAcc || undefined,
              ttftMs: firstAt - t0,
              tps: genSec > 0 ? liveTokens / genSec : undefined,
              outputTokens: liveTokens,
              tokensApprox: true,
            })
          } else if (part.type === 'error') {
            const e = (part as { error?: unknown }).error
            throw e instanceof Error ? e : new Error(typeof e === 'string' ? e : JSON.stringify(e))
          }
        }
        const endAt = performance.now()
        // prefer the provider's real token usage; fall back to the estimate
        let outputTokens: number | undefined
        let totalTokens: number | undefined
        try {
          const usage = await result.usage
          if (usage && typeof usage.outputTokens === 'number')
            outputTokens = usage.outputTokens
          if (usage && typeof usage.totalTokens === 'number')
            totalTokens = usage.totalTokens
        } catch {
          // some providers don't report usage on streamed responses
        }
        const exact = typeof outputTokens === 'number' && outputTokens > 0
        const tokens = exact
          ? outputTokens!
          : Math.max(1, Math.round((acc.length + reasoningAcc.length) / 4))
        const genSec = ((firstAt != null ? endAt - firstAt : endAt - t0) || 1) / 1000
        updateColumn(key, {
          done: true,
          totalMs: endAt - t0,
          tps: genSec > 0 ? tokens / genSec : undefined,
          outputTokens: tokens,
          totalTokens,
          tokensApprox: !exact,
        })
      } catch (err) {
        updateColumn(key, {
          done: true,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    },
    [providers, updateColumn]
  )

  const run = useCallback(async () => {
    const picks = options.filter((o) => selected.has(o.key))
    if (!prompt.trim() || picks.length === 0) return

    setRunning(true)
    setColumns(
      picks.map((o) => ({
        provider: o.provider,
        modelId: o.modelId,
        label: o.label,
        text: '',
        done: false,
      }))
    )

    const userPrompt = prompt

    if (mode === 'parallel') {
      await Promise.all(picks.map((o) => runOne(o, userPrompt)))
    } else if (mode === 'sequential') {
      for (const o of picks) await runOne(o, userPrompt)
    } else {
      // by-backend: group by provider, run groups in parallel but each
      // group's models one at a time (so a single serialized backend never
      // races two requests against itself and drops a column).
      const groups = new Map<string, typeof picks>()
      for (const o of picks) {
        const g = groups.get(o.provider)
        if (g) g.push(o)
        else groups.set(o.provider, [o])
      }
      await Promise.all(
        Array.from(groups.values()).map(async (group) => {
          for (const o of group) await runOne(o, userPrompt)
        })
      )
    }

    setRunning(false)
  }, [options, selected, prompt, mode, runOne])

  // fastest finished column by tok/s — highlighted when comparing >1 model
  const fastestKey = useMemo(() => {
    let best: { key: ColumnKey; tps: number } | null = null
    for (const c of columns) {
      if (c.done && !c.error && typeof c.tps === 'number' && c.tps > 0) {
        const k = keyOf(c.provider, c.modelId)
        if (!best || c.tps > best.tps) best = { key: k, tps: c.tps }
      }
    }
    return columns.length > 1 ? best?.key : undefined
  }, [columns])

  return (
    <div className="flex h-full w-full flex-col">
      <HeaderPage>
        <div className="flex items-center gap-2">
          <IconColumns size={18} />
          <span className="font-medium">Compare</span>
        </div>
      </HeaderPage>

      <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
        {/* model picker */}
        <div className="flex flex-col gap-2">
          <span className="text-sm text-main-view-fg/70">
            Pick models to compare ({selected.size} selected)
          </span>
          {options.length === 0 ? (
            <p className="text-sm text-main-view-fg/60">
              No models available yet. Add a provider (e.g. OpenRouter) and an
              API key in Settings → Providers first.
            </p>
          ) : (
            <div className="flex max-h-32 flex-wrap gap-2 overflow-y-auto">
              {options.map((o) => {
                const isOn = selected.has(o.key)
                return (
                  <button
                    key={o.key}
                    onClick={() => toggle(o.key)}
                    className={cn(
                      'rounded-md border px-2.5 py-1 text-xs transition-colors',
                      isOn
                        ? 'border-accent bg-accent/15 text-accent'
                        : 'border-main-view-fg/15 text-main-view-fg/70 hover:bg-main-view-fg/5'
                    )}
                    title={`${o.provider} · ${o.modelId}`}
                  >
                    {o.label}
                    <span className="ml-1 opacity-50">· {o.provider}</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* execution mode */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-main-view-fg/70">Run:</span>
          <div className="flex overflow-hidden rounded-md border border-main-view-fg/15">
            {RUN_MODES.map((m) => (
              <button
                key={m.key}
                onClick={() => setMode(m.key)}
                disabled={running}
                title={m.hint}
                className={cn(
                  'px-2.5 py-1 text-xs transition-colors disabled:opacity-50',
                  mode === m.key
                    ? 'bg-accent/15 text-accent'
                    : 'text-main-view-fg/70 hover:bg-main-view-fg/5'
                )}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {/* prompt input */}
        <div className="flex items-end gap-2">
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Ask every selected model the same thing…"
            className="min-h-16 flex-1"
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault()
                void run()
              }
            }}
          />
          <Button
            onClick={() => void run()}
            disabled={running || selected.size === 0 || !prompt.trim()}
          >
            {running ? (
              <IconLoader2 size={16} className="mr-1.5 animate-spin" />
            ) : (
              <IconSend size={16} className="mr-1.5" />
            )}
            Send
          </Button>
        </div>

        {/* result columns */}
        {columns.length > 0 && (
          <div
            className="grid min-h-0 flex-1 gap-3 overflow-hidden"
            style={{
              gridTemplateColumns: `repeat(${Math.min(columns.length, 4)}, minmax(0, 1fr))`,
            }}
          >
            {columns.map((c) => {
              const ck = keyOf(c.provider, c.modelId)
              const isFastest = ck === fastestKey
              const hasStats = c.tps != null || c.ttftMs != null
              return (
              <div
                key={ck}
                className={cn(
                  'flex min-h-0 flex-col rounded-lg border',
                  isFastest ? 'border-accent/60' : 'border-main-view-fg/10'
                )}
              >
                <div className="flex items-center justify-between border-b border-main-view-fg/10 px-3 py-2">
                  <span className="truncate text-sm font-medium" title={c.modelId}>
                    {c.label}
                  </span>
                  <span className="ml-2 flex shrink-0 items-center gap-1.5 text-xs text-main-view-fg/50">
                    {isFastest && (
                      <span className="flex items-center gap-0.5 rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-medium text-accent">
                        <IconBolt size={10} />
                        fastest
                      </span>
                    )}
                    {c.error ? (
                      <IconAlertTriangle size={14} className="text-destructive" />
                    ) : c.done ? (
                      'done'
                    ) : (
                      <IconLoader2 size={14} className="animate-spin" />
                    )}
                  </span>
                </div>
                {hasStats && !c.error && (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 border-b border-main-view-fg/10 px-3 py-1 font-mono text-[11px] text-main-view-fg/55">
                    {c.tps != null && (
                      <span className="text-main-view-fg/70" title="decode speed (output tokens per second)">
                        <IconBolt size={11} className="-mt-0.5 mr-0.5 inline" />
                        {c.tps.toFixed(1)} tok/s
                      </span>
                    )}
                    {c.ttftMs != null && (
                      <span title="time to first token">ttft {fmtMs(c.ttftMs)}</span>
                    )}
                    {c.outputTokens != null && (
                      <span title={c.tokensApprox ? 'estimated output tokens' : 'output tokens'}>
                        {c.tokensApprox ? '~' : ''}
                        {c.outputTokens} tok
                      </span>
                    )}
                    {c.totalMs != null && (
                      <span title="total time">{fmtMs(c.totalMs)}</span>
                    )}
                  </div>
                )}
                <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2 text-sm">
                  {c.reasoning && !c.error && (
                    <details
                      open={!c.text}
                      className="mb-2 rounded-md bg-main-view-fg/4 px-2 py-1 text-xs text-main-view-fg/55"
                    >
                      <summary className="cursor-pointer select-none text-main-view-fg/70">
                        Reasoning
                      </summary>
                      <div className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap italic">
                        {c.reasoning}
                      </div>
                    </details>
                  )}
                  <div className="whitespace-pre-wrap">
                    {c.error ? (
                      <span className="text-destructive">{c.error}</span>
                    ) : c.text ? (
                      c.text
                    ) : c.done && c.reasoning ? (
                      <span className="text-main-view-fg/40">
                        (no answer — model returned only reasoning; raise its token limit)
                      </span>
                    ) : (
                      <span className="text-main-view-fg/40">…</span>
                    )}
                  </div>
                </div>
              </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
