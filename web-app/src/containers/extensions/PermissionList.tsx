import type { ReactNode } from 'react'
import type { PermissionString } from '@janhq/extension-api'
import { useTranslation } from '@/i18n/react-i18next-compat'
import {
  PERMISSIONS,
  parsePermission,
  reachesLocalApiServer,
  riskOf,
  type PermissionRisk,
} from '@/lib/extensions/permissions'
import { cn } from '@/lib/utils'

const RISK_CLASS: Record<PermissionRisk, string> = {
  low: 'text-muted-foreground',
  medium: 'text-amber-600 dark:text-amber-400',
  high: 'text-destructive',
}

function PermissionRow({
  permission,
  action,
}: {
  permission: PermissionString
  action?: ReactNode
}) {
  const { t } = useTranslation()
  const parsed = parsePermission(permission)
  if (!parsed) return null
  const info = PERMISSIONS[parsed.kind]
  const host = parsed.kind === 'network' ? parsed.host : undefined
  const risk = riskOf(permission)
  return (
    <li className="flex items-start gap-2">
      <div className="flex flex-col gap-0.5 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">
            {t(info.titleKey, { host })}
          </span>
          <span className={cn('text-xs', RISK_CLASS[risk])}>
            {t(`extensions:risk.${risk}`)}
          </span>
        </div>
        <span className="text-xs text-muted-foreground">
          {t(info.descriptionKey)}
        </span>
        {reachesLocalApiServer(permission) && (
          <span className="text-xs text-amber-600 dark:text-amber-400">
            {t('extensions:permissions.network.localServers')}
          </span>
        )}
      </div>
      {action}
    </li>
  )
}

/**
 * Permissions with their translated title, description and risk, as every
 * consent and settings screen shows them. `action` adds a control per row
 * (the details page's Revoke).
 */
export function PermissionList({
  permissions,
  label,
  action,
}: {
  permissions: readonly PermissionString[]
  /** Accessible name of the list, when a screen shows more than one. */
  label?: string
  action?: (permission: PermissionString) => ReactNode
}) {
  const { t } = useTranslation()
  if (permissions.length === 0)
    return <p className="text-sm">{t('extensions:noPermissions')}</p>
  return (
    <ul aria-label={label} className="flex flex-col gap-2">
      {permissions.map((p) => (
        <PermissionRow key={p} permission={p} action={action?.(p)} />
      ))}
    </ul>
  )
}
