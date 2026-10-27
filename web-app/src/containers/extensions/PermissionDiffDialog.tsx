import { useTranslation } from '@/i18n/react-i18next-compat'
import { useLocalize } from '@/lib/extensions/l10n'
import { PermissionList } from './PermissionList'
import { StagedDialog, type StagedDialogProps } from './StagedDialog'

/**
 * Consent to an update: only what it asks for beyond the current grants.
 * Permissions it no longer requests are listed for information; they are
 * dropped from the grants on confirm.
 */
export function PermissionDiffDialog(props: StagedDialogProps) {
  const { t } = useTranslation()
  const localize = useLocalize()
  const { manifest, permissionDiff } = props.staged
  const addedLabel = t('extensions:update.added')
  const removedLabel = t('extensions:update.removed')
  return (
    <StagedDialog
      {...props}
      title={t('extensions:update.title', {
        name: localize(manifest, manifest.displayName),
        version: manifest.version,
      })}
      description={t('extensions:update.description', {
        version: props.staged.existing?.version,
      })}
      confirmLabel={t('extensions:update.confirm')}
    >
      {permissionDiff.added.length > 0 ? (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium">{addedLabel}</span>
          <PermissionList
            permissions={permissionDiff.added}
            label={addedLabel}
          />
        </div>
      ) : (
        <p className="text-sm">{t('extensions:update.nothingAdded')}</p>
      )}
      {permissionDiff.removed.length > 0 && (
        <div className="flex flex-col gap-1 opacity-70">
          <span className="text-xs font-medium">{removedLabel}</span>
          <PermissionList
            permissions={permissionDiff.removed}
            label={removedLabel}
          />
        </div>
      )}
    </StagedDialog>
  )
}
