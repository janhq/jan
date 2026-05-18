/**
 * Wall-clock markers for end-to-end TTFT diagnosis (dev / optional prod logging).
 *
 * α — send click / processAndSendMessage start
 * β — after processAttachmentsForSend
 * γ — refreshTools start / end
 * δ — ModelFactory.createModel start / end
 * ε — stream_local_http invoke / first IPC chunk
 * ζ — (Rust) proxy request received / upstream headers
 * η — (Rust) llama first token / prompt_eval logged
 * θ — first non-empty content rendered in RenderMarkdown
 */

export type TtftMarker =
  | 'alpha'
  | 'beta'
  | 'gammaStart'
  | 'gammaEnd'
  | 'deltaStart'
  | 'deltaEnd'
  | 'epsilonInvoke'
  | 'epsilonFirstChunk'
  | 'zetaProxyIn'
  | 'zetaUpstreamHeaders'
  | 'etaFirstToken'
  | 'thetaFirstRender'

export interface TtftTimings {
  alpha?: number
  beta?: number
  gammaStart?: number
  gammaEnd?: number
  deltaStart?: number
  deltaEnd?: number
  epsilonInvoke?: number
  epsilonFirstChunk?: number
  zetaProxyIn?: number
  zetaUpstreamHeaders?: number
  etaFirstToken?: number
  thetaFirstRender?: number
}

const TTFT_ENABLED =
  import.meta.env.DEV || import.meta.env.VITE_TTFT_TIMING === 'true'

let active: TtftTimings | null = null

// #region agent log
function ttftDebugLog(
  location: string,
  message: string,
  data?: Record<string, unknown>
): void {
  try {
    fetch('http://127.0.0.1:7576/ingest/349dbbed-26a7-42bf-b66c-4a6027726691', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Debug-Session-Id': '4aeb88',
      },
      body: JSON.stringify({
        sessionId: '4aeb88',
        location,
        message,
        data,
        timestamp: Date.now(),
      }),
    }).catch(() => {})
  } catch {
    /* no-op */
  }
}

export function ttftPreBegin(label: string, data?: Record<string, unknown>): void {
  ttftDebugLog('ttft-timing.ts:preBegin', label, {
    ...data,
    sinceAlphaMs:
      active?.alpha !== undefined ? Date.now() - active.alpha : null,
  })
}
// #endregion

export function ttftEnabled(): boolean {
  return TTFT_ENABLED
}

export function ttftBegin(): void {
  // #region agent log
  ttftDebugLog('ttft-timing.ts:ttftBegin', 'alpha set', {
    wallMs: Date.now(),
  })
  // #endregion
  if (!TTFT_ENABLED) return
  active = { alpha: Date.now() }
}

export function ttftMark(marker: TtftMarker): void {
  // #region agent log
  ttftDebugLog('ttft-timing.ts:ttftMark', marker, {
    wallMs: Date.now(),
    sinceAlphaMs:
      active?.alpha !== undefined ? Date.now() - active.alpha : null,
  })
  // #endregion
  if (!TTFT_ENABLED || !active) return
  active[marker] = Date.now()
}

export function ttftMarkFromRust(
  marker: 'zetaProxyIn' | 'zetaUpstreamHeaders' | 'etaFirstToken',
  epochMs: number
): void {
  // #region agent log
  ttftDebugLog('ttft-timing.ts:ttftMarkFromRust', marker, {
    epochMs,
    nowMs: Date.now(),
    sinceAlphaMs:
      active?.alpha !== undefined ? epochMs - active.alpha : null,
  })
  // #endregion
  if (!TTFT_ENABLED || !active) return
  active[marker] = epochMs
}

function delta(from?: number, to?: number): number | undefined {
  if (from === undefined || to === undefined) return undefined
  return Math.round(to - from)
}

export function ttftReport(reason: string): void {
  if (!TTFT_ENABLED || !active) return
  const t = active
  const rows: Record<string, number | string> = {
    reason,
    'β−α attachments': delta(t.alpha, t.beta) ?? '—',
    'γ−β refreshTools': delta(t.beta, t.gammaEnd) ?? delta(t.alpha, t.gammaEnd) ?? '—',
    'δ−γ createModel': delta(t.gammaEnd, t.deltaEnd) ?? '—',
    'ε−δ first IPC chunk': delta(t.deltaEnd, t.epsilonFirstChunk) ?? '—',
    'ζ−ε proxy→upstream': delta(t.epsilonFirstChunk, t.zetaUpstreamHeaders) ?? '—',
    'η−ζ backend TTFT': delta(t.zetaUpstreamHeaders, t.etaFirstToken) ?? '—',
    'θ−α total visible': delta(t.alpha, t.thetaFirstRender) ?? '—',
    'θ−η UI after stream': delta(t.etaFirstToken, t.thetaFirstRender) ?? '—',
  }
  console.table(rows)
  // #region agent log
  ttftDebugLog('ttft-timing.ts:ttftReport', reason, {
    rows,
    rawMarkers: t as unknown as Record<string, unknown>,
  })
  // #endregion
  active = null
}
