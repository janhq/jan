import { useTranslation } from '@/i18n/react-i18next-compat'
import { useLocalize } from '@/lib/extensions/l10n'
import { PermissionList } from './PermissionList'
import { StagedDialog, type StagedDialogProps } from './StagedDialog'

/** Consent to a first install: everything the extension requests. */
export function ConsentDialog(props: StagedDialogProps) {
  const { t } = useTranslation()
  const localize = useLocalize()
  const { manifest } = props.staged
  return (
    <StagedDialog
      {...props}
      title={t('extensions:install.title', {
        name: localize(manifest, manifest.displayName),
      })}
      description={t('extensions:install.description', {
        publisher: manifest.publisher,
        version: manifest.version,
      })}
      confirmLabel={t('extensions:install.confirm')}
    >
      <PermissionList permissions={manifest.permissions} />
    </StagedDialog>
  )
}
