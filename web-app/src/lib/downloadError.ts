export type DownloadFailureReason =
  | 'dns'
  | 'refused'
  | 'timeout'
  | 'tls'
  | 'proxy'
  | 'unreachable'

// Order matters: the first match wins, so a specific cause beats the generic
// "error sending request" wrapper that every reqwest connect failure carries.
const RULES: ReadonlyArray<readonly [DownloadFailureReason, RegExp]> = [
  ['tls', /certificate|\btls\b|\bssl\b|handshake|invalid peer/i],
  ['proxy', /proxy/i],
  ['dns', /dns error|failed to lookup|no such host|name or service not known|nodename nor servname|os error 11001/i],
  ['timeout', /timed out|timeout|os error 10060/i],
  ['refused', /connection refused|os error 10061|actively refused/i],
  ['unreachable', /error sending request|error trying to connect|tcp connect error|network is unreachable|connection (reset|closed|aborted)|os error (10051|10054|10053)/i],
]

/**
 * Names the network cause inside a download error string, or undefined when
 * the text carries nothing a user could act on (the toast then points at the logs).
 */
export function classifyDownloadError(
  error: string
): DownloadFailureReason | undefined {
  // reqwest embeds the requested URL: "error sending request for url (https://…)".
  // A model path such as /proxy/ or /connection-reset/ must not read as a cause.
  const cause = error.replace(/https?:\/\/[^\s)]*/gi, '')
  for (const [reason, pattern] of RULES) {
    if (pattern.test(cause)) return reason
  }
  return undefined
}
