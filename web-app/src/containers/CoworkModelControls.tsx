import { useCallback, useEffect, useRef, useState } from 'react'
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
import {
  coworkLocalModel,
  coworkModelContext,
  increaseCoworkContext,
} from '@/lib/coworkModelControls'

export function CoworkModelControls() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const serviceHub = useServiceHub()
  const provider = useModelProvider((state) =>
    state.providers.find((item) => item.provider === state.selectedProvider)
  )
  const modelId = useModelProvider((state) => state.selectedModel?.id)
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const model = coworkLocalModel(provider, modelId)
  const context = coworkModelContext(provider, modelId)
  const nextContext = context?.next
  const providerName = provider?.provider
  const fitSetting =
    model && providerName === 'llamacpp'
      ? provider?.settings.find((setting) => setting.key === 'fit')
      : undefined
  const fitEnabled = fitSetting?.controller_props?.value === true

  const notifyFailure = useCallback(
    (error: unknown, name: string) => {
      toast.error(t('common:modelControls.updateFailed'), {
        description: error instanceof Error ? error.message : String(error),
        action: {
          label: t('common:toast.openSettings'),
          onClick: () =>
            void navigate({
              to: route.settings.providers,
              params: { providerName: name },
            }),
        },
      })
    },
    [navigate, t]
  )

  useEffect(() => {
    const setting = model?.settings?.ctx_len
    const knownMax = Number(setting?.controller_props?.max)
    if (
      !providerName ||
      !model ||
      !setting ||
      (Number.isInteger(knownMax) && knownMax > 0)
    )
      return
    const id = model.id
    let cancelled = false
    void serviceHub
      .models()
      .getModelContextLimit(id, providerName)
      .then((max) => {
        if (cancelled) return
        if (max === undefined || !Number.isInteger(max) || max <= 0)
          throw new Error(
            'The model does not report a supported context limit. Check its provider settings.'
          )
        const state = useModelProvider.getState()
        const latest = state.getProviderByName(providerName)
        if (!latest) return
        state.updateProvider(providerName, {
          models: latest.models.map((item) =>
            item.id === id
              ? ({
                  ...item,
                  settings: {
                    ...item.settings,
                    ctx_len: {
                      ...item.settings?.ctx_len,
                      controller_props: {
                        ...item.settings?.ctx_len?.controller_props,
                        max,
                      },
                    },
                  },
                } as Model)
              : item
          ),
        })
      })
      .catch((error: unknown) => {
        if (!cancelled) notifyFailure(error, providerName)
      })
    return () => {
      cancelled = true
    }
  }, [model, providerName, serviceHub, notifyFailure])

  const updateModel = async () => {
    if (!providerName || !modelId || pending.current) return
    pending.current = true
    setBusy(true)
    try {
      await increaseCoworkContext(serviceHub.models(), providerName, modelId)
    } catch (error) {
      notifyFailure(error, providerName)
    } finally {
      pending.current = false
      setBusy(false)
    }
  }

  const updateFit = async (checked: boolean) => {
    if (!provider || !fitSetting || pending.current) return
    const updatedSettings = provider.settings.map((setting) =>
      setting.key === 'fit'
        ? {
            ...setting,
            controller_props: { ...setting.controller_props, value: checked },
          }
        : setting
    )
    pending.current = true
    setBusy(true)
    try {
      await serviceHub
        .providers()
        .updateSettings(provider.provider, updatedSettings)
      const state = useModelProvider.getState()
      const latest = state.getProviderByName(provider.provider)
      if (latest)
        state.updateProvider(provider.provider, {
          settings: latest.settings.map((setting) =>
            setting.key === 'fit'
              ? {
                  ...setting,
                  controller_props: {
                    ...setting.controller_props,
                    value: checked,
                  },
                }
              : setting
          ),
        })
    } catch (error) {
      notifyFailure(error, provider.provider)
    } finally {
      pending.current = false
      setBusy(false)
    }
  }

  const label = context
    ? `${t('common:modelControls.label')}: ${context.value.toLocaleString()}`
    : t('common:modelControls.label')
  if (!model || (!fitSetting && !context)) return null

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
        {context && (
          <>
            <DropdownMenuLabel>
              {t('common:modelControls.context')}
            </DropdownMenuLabel>
            <DropdownMenuItem
              disabled={nextContext === undefined || busy}
              onClick={() => void updateModel()}
            >
              {nextContext === undefined
                ? t('common:modelControls.contextMax')
                : t('common:modelControls.increaseContext', {
                    value: nextContext.toLocaleString(),
                  })}
            </DropdownMenuItem>
          </>
        )}
        {fitSetting && (
          <>
            {context && <DropdownMenuSeparator />}
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
