import { Button } from '@/components/ui/button'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { cn } from '@/lib/utils'
import type { MCPAuthStatus } from '@/services/mcp/types'

/**
 * The `Auth:` line for one remote MCP server in the settings list: a badge for
 * the state plus the actions that state allows.
 *
 * Renders nothing for `notApplicable` (a stdio server has no HTTP transport to
 * authorize). A `staticHeader` server *is* shown, as a badge with no actions:
 * the user configured their own credential and needs to see that it is what is
 * being used, but replacing it with OAuth would break it.
 */
interface McpServerAuthProps {
  status: MCPAuthStatus | undefined
  authorizing: boolean
  /** Consent url, while a flow is pending, for when the browser did not open. */
  consentUrl?: string
  onAuthorize: () => void
  onClearAuth: () => void
}

/** Badge tint per state: green means usable, amber needs attention, red is absent. */
const TONE: Record<MCPAuthStatus['state'], string> = {
  notApplicable: 'text-muted-foreground bg-secondary',
  staticHeader: 'text-green-700 dark:text-green-500 bg-secondary',
  authenticated: 'text-green-700 dark:text-green-500 bg-secondary',
  expired: 'text-amber-700 dark:text-amber-500 bg-secondary',
  staleResource: 'text-amber-700 dark:text-amber-500 bg-secondary',
  unauthenticated: 'text-red-700 dark:text-red-500 bg-secondary',
}

/** A coarse "42m" / "3h" distance from now; the exact second is never useful. */
function spanLabel(seconds: number): string {
  const left = Math.max(0, seconds)
  if (left < 3600) return `${Math.max(1, Math.floor(left / 60))}m`
  if (left < 86400) return `${Math.floor(left / 3600)}h`
  return `${Math.floor(left / 86400)}d`
}

function secondsFromNow(unixSeconds: number): number {
  return unixSeconds - Math.floor(Date.now() / 1000)
}

export function McpServerAuth({
  status,
  authorizing,
  consentUrl,
  onAuthorize,
  onClearAuth,
}: McpServerAuthProps) {
  const { t } = useTranslation()

  if (!status || status.state === 'notApplicable') return null

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <span className="text-muted-foreground">{t('mcp-servers:auth.label')}</span>
      <span
        className={cn(
          'rounded-sm border px-2 py-0.5 text-xs',
          TONE[status.state]
        )}
      >
        {t(`mcp-servers:auth.state.${status.state}`)}
      </span>
      {status.expiresAt !== null && (
        <span className="text-xs text-muted-foreground">
          {status.state === 'expired'
            ? t('mcp-servers:auth.expiredAgo', {
                duration: spanLabel(-secondsFromNow(status.expiresAt)),
              })
            : t('mcp-servers:auth.expiresIn', {
                duration: spanLabel(secondsFromNow(status.expiresAt)),
              })}
        </span>
      )}

      {status.canAuthenticate && (
        <Button
          size="sm"
          variant="link"
          className="h-auto p-0"
          disabled={authorizing}
          onClick={onAuthorize}
        >
          {authorizing
            ? t('mcp-servers:auth.waiting')
            : status.renewable
              ? t('mcp-servers:auth.renew')
              : status.hasCredentials
                ? t('mcp-servers:auth.reauthenticate')
                : t('mcp-servers:auth.authenticate')}
        </Button>
      )}
      {status.hasCredentials && !authorizing && (
        <Button
          size="sm"
          variant="link"
          className="h-auto p-0"
          onClick={onClearAuth}
        >
          {t('mcp-servers:auth.clear')}
        </Button>
      )}

      {/* The flow is already waiting on the redirect by the time this shows, so
          a browser that failed to launch is still recoverable by hand. */}
      {authorizing && consentUrl && (
        <a
          href={consentUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-blue-500 hover:underline"
        >
          {t('mcp-servers:auth.openSignInPage')}
        </a>
      )}
    </div>
  )
}
