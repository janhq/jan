import { useMemo, useState } from 'react'
import { Settings2 } from 'lucide-react'
import { toast } from 'sonner'
import { useNavigate } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { route } from '@/constants/routes'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { nextCoworkContextSize } from '@/lib/coworkModelControls'

const DEFAULT_CONTEXT_MAX = 131072


function settingValue(
  setting: ProviderSetting | undefined
): string | boolean | number | undefined {
  return setting?.controller_props?.value
}

function modelContextValue(model: Model): number {
  const value = model.settings?.ctx_len?.controller_props?.value
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 8192
}

function modelContextMax(model: Model): number {
  const value = model.settings?.ctx_len?.controller_props?.max
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_CONTEXT_MAX
}

export function CoworkModelControls() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const serviceHub = useServiceHub()
  const selectedProvider = useModelProvider((state) => state.selectedProvider)
  const selectedModel = useModelProvider((state) => state.selectedModel)
  const getProviderByName = useModelProvider((state) => state.getProviderByName)
  const updateProvider = useModelProvider((state) => state.updateProvider)
  const selectModelProvider = useModelProvider(
    (state) => state.selectModelProvider
  )
  const [busy, setBusy] = useState(false)

  const provider = getProviderByName(selectedProvider)
  const isSupported =
    selectedProvider === 'llamacpp' &&
    provider?.active !== false &&
    selectedModel != null &&
    provider?.models.some((model) => model.id === selectedModel.id)
  const fitSetting = isSupported
    ? provider?.settings.find((setting) => setting.key === 'fit')
    : undefined
  const context = isSupported ? modelContextValue(selectedModel) : 0
  const contextMax = isSupported ? modelContextMax(selectedModel) : 0
  const nextContext = isSupported
    ? nextCoworkContextSize(context, contextMax)
    : undefined
  const fitEnabled = settingValue(fitSetting) === true

  const notifyFailure = (error: unknown) => {
    const detail = error instanceof Error ? error.message : String(error)
    toast.error(t('common:modelControls.updateFailed'), {
      description: detail,
      action: {
        label: t('common:toast.openSettings'),
        onClick: () =>
          void navigate({
            to: route.settings.providers,
            params: { providerName: 'llamacpp' },
          }),
      },
    })
  }

  const updateModel = async (patch: { ctx_len: number }) => {
    if (!provider || !selectedModel || busy) return
    const modelIndex = provider.models.findIndex(
      (model) => model.id === selectedModel.id
    )
    if (modelIndex === -1) return
    const previousModels = provider.models
    const updatedModel = {
      ...selectedModel,
      settings: {
        ...selectedModel.settings,
        ctx_len: {
          ...(selectedModel.settings?.ctx_len ?? {}),
          controller_props: {
            ...(selectedModel.settings?.ctx_len?.controller_props ?? {}),
            value: patch.ctx_len,
          },
        },
      },
    } as Model
    const updatedModels = [...provider.models]
    updatedModels[modelIndex] = updatedModel
    setBusy(true)
    updateProvider(provider.provider, { models: updatedModels })
    selectModelProvider(provider.provider, selectedModel.id)
    try {
      await serviceHub.models().updateModelSettings(selectedModel.id, patch)
    } catch (error) {
      updateProvider(provider.provider, { models: previousModels })
      selectModelProvider(provider.provider, selectedModel.id)
      notifyFailure(error)
    } finally {
      setBusy(false)
    }
  }

  const updateFit = async (checked: boolean) => {
    if (!provider || !fitSetting || busy) return
    const previousSettings = provider.settings
    const updatedSettings = provider.settings.map((setting) =>
      setting.key === 'fit'
        ? {
            ...setting,
            controller_props: {
              ...setting.controller_props,
              value: checked,
            },
          }
        : setting
    )
    setBusy(true)
    updateProvider(provider.provider, { settings: updatedSettings })
    try {
      await serviceHub.providers().updateSettings(provider.provider, updatedSettings)
    } catch (error) {
      updateProvider(provider.provider, { settings: previousSettings })
      notifyFailure(error)
    } finally {
      setBusy(false)
    }
  }

  const label = useMemo(() => {
    if (!isSupported) return ''
    const contextLabel = context.toLocaleString()
    return `${t('common:modelControls.label')}: ${contextLabel}`
  }, [context, isSupported, t])

  if (!isSupported || (!fitSetting && nextContext === undefined)) return null

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={label}
              disabled={busy}
              className="shrink-0 text-muted-foreground"
            >
              <Settings2 aria-hidden className="size-[18px]" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>{t('common:modelControls.context')}</DropdownMenuLabel>
        <DropdownMenuItem
          disabled={nextContext === undefined || busy}
          onClick={() =>
            nextContext !== undefined && void updateModel({ ctx_len: nextContext })
          }
        >
          {nextContext === undefined
            ? t('common:modelControls.contextMax')
            : t('common:modelControls.increaseContext', {
                value: nextContext.toLocaleString(),
              })}
        </DropdownMenuItem>
        {fitSetting && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem
              checked={fitEnabled}
              disabled={busy}
              onCheckedChange={(checked) => void updateFit(checked === true)}
            >
              {t('common:modelControls.fit')}
            </DropdownMenuCheckboxItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
