import { useTranslation } from '@/i18n/react-i18next-compat'
import type { InstalledExtension } from '@/services/extensions/types'

const DANGER =
  'bg-destructive/10 px-1 py-0.5 rounded text-destructive text-xs font-medium'
const MUTED =
  'bg-foreground/10 px-1 py-0.5 rounded text-foreground/70 text-xs font-medium'

/** Marks a bundle nobody vouched for: installed from a file, not an index. */
export function UnverifiedBadge() {
  const { t } = useTranslation()
  return <span className={DANGER}>{t('extensions:origin.unverified')}</span>
}

/** Marks an index source with no pinned key: nothing signs its listing. */
export function UnsignedSourceBadge() {
  const { t } = useTranslation()
  return <span className={DANGER}>{t('extensions:origin.unsignedSource')}</span>
}

/**
 * How far an installed version can be trusted: verified by the key pinned
 * for its source, only integrity checked against an unsigned index, or
 * unverified (a file from disk).
 */
export function TrustBadge({
  entry,
}: {
  entry: Pick<InstalledExtension, 'verified' | 'integrityChecked' | 'source'>
}) {
  const { t } = useTranslation()
  if (entry.verified && entry.source.kind === 'index')
    return (
      <span className={MUTED}>
        {t('extensions:origin.verifiedBy', {
          source: entry.source.sourceName,
        })}
      </span>
    )
  if (entry.integrityChecked)
    return (
      <span className={MUTED}>{t('extensions:origin.integrityChecked')}</span>
    )
  return <UnverifiedBadge />
}
