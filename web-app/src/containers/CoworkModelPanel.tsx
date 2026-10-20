import { CoworkSidePanel } from '@/containers/CoworkSidePanel'
import { ModelSettingFields } from '@/containers/ModelSetting'
import ProvidersAvatar from '@/containers/ProvidersAvatar'
import { coworkModelContext, formatContextSize } from '@/lib/coworkModelControls'
import { getModelDisplayName } from '@/lib/utils'
import { useTranslation } from '@/i18n/react-i18next-compat'

/**
 * Model settings docked as a Cowork rail, so the llamacpp/mlx knobs sit beside
 * the transcript like the diff/files/todo panels instead of the header Sheet.
 * The form body itself is shared with ModelSetting (ModelSettingFields).
 */
export function CoworkModelPanel({
  model,
  provider,
  onClose,
}: {
  model: Model
  provider: ProviderObject
  onClose: () => void
}): React.ReactElement {
  const { t } = useTranslation()
  const context = coworkModelContext(provider, model.id)

  return (
    <CoworkSidePanel
      title={getModelDisplayName(model)}
      leading={
        <div className="shrink-0">
          <ProvidersAvatar provider={provider} />
        </div>
      }
      summary={
        context ? (
          <span
            className="shrink-0 font-mono text-xs tabular-nums text-main-view-fg/60"
            title={t('common:modelPanel.contextTooltip', {
              value: context.value.toLocaleString(),
              max: context.max.toLocaleString(),
            })}
          >
            {formatContextSize(context.value)}
          </span>
        ) : null
      }
      onClose={onClose}
    >
      <div className="flex h-full flex-col">
        <ModelSettingFields model={model} provider={provider} />
      </div>
    </CoworkSidePanel>
  )
}
