import { HomeWorkspacePicker } from './HomeWorkspacePicker'
import type { ComponentProps } from 'react'
import { useTranslation } from '@/i18n/react-i18next-compat'

/** Explicit draft scope, separate from files attached to a prompt. Used by the
 * established task workflow now; reusable by the future continuity boundary. */
export function UnifiedHomeScope(scope: ComponentProps<typeof HomeWorkspacePicker>) {
  const { t } = useTranslation()
  return (
    <section aria-label={t('common:conversationScope.label')} className="space-y-2">
      <HomeWorkspacePicker {...scope} />
      <p className="text-xs leading-5 text-muted-foreground" role={scope.folder ? 'status' : undefined}>
        {scope.folder
          ? t('common:conversationScope.writable')
          : t('common:conversationScope.optional')}
      </p>
      <p className="text-xs leading-5 text-muted-foreground">
        {t('common:conversationScope.permissions')}
      </p>
    </section>
  )
}
