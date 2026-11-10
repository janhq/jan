import { formatLoadDiagnostics } from '@/lib/engineError'
import { getCoworkEnvironment } from '@/lib/coworkEnv'

/**
 * The paste-ready report for a failed engine load, with this app's version and
 * OS filled in. Undefined when the error carries no diagnostics, which is the
 * caller's cue not to offer the action.
 */
export async function buildLoadDiagnosticsReport(
  error: unknown
): Promise<string | undefined> {
  const env = await getCoworkEnvironment()
  return formatLoadDiagnostics(error, {
    appVersion: env.appVersion ?? undefined,
    os: [env.os, env.arch].filter(Boolean).join(' ') || undefined,
  })
}
