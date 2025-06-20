import { route } from '@/constants/routes'
import { useModelProvider } from '@/hooks/useModelProvider'
import { cn, getProviderTitle } from '@/lib/utils'
import { useNavigate, useMatches, Link } from '@tanstack/react-router'
import { IconArrowLeft, IconCirclePlus } from '@tabler/icons-react'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { useCallback, useState } from 'react'
import { openAIProviderSettings } from '@/mock/data'
import ProvidersAvatar from '@/containers/ProvidersAvatar'
import cloneDeep from 'lodash/cloneDeep'
import { toast } from 'sonner'
import { useTranslation } from '@/i18n/react-i18next-compat'

const ProvidersMenu = ({
  stepSetupRemoteProvider,
}: {
  stepSetupRemoteProvider: boolean
}) => {
  const { providers, addProvider } = useModelProvider()
  const navigate = useNavigate()
  const matches = useMatches()
  const [name, setName] = useState('')
  const { t } = useTranslation()

  const createProvider = useCallback(() => {
    if (providers.some((e) => e.provider === name)) {
      toast.error(t('providerAlreadyExists', { name }))
      return
    }
    const newProvider = {
      provider: name,
      active: true,
      models: [],
      settings: cloneDeep(openAIProviderSettings) as ProviderSetting[],
      api_key: '',
      base_url: 'https://api.openai.com/v1',
    }
    addProvider(newProvider)
    setTimeout(() => {
      navigate({
        to: route.settings.providers,
        params: {
          providerName: name,
        },
      })
    }, 0)
  }, [providers, name, addProvider, t, navigate])

  return (
    <div className="w-44 py-2 border-r border-main-view-fg/5 pb-10 overflow-y-auto">
      <Link to={route.settings.general}>
        <div className="flex items-center gap-0.5 ml-3 mb-4 mt-1">
          <IconArrowLeft size={16} className="text-main-view-fg/70" />
          <span className="text-main-view-fg/80">{t('common:back')}</span>
        </div>
      </Link>
      <div className="first-step-setup-remote-provider">
        {providers.map((provider, index) => {
          const isActive = matches.some(
            (match) =>
              match.routeId === '/settings/providers/$providerName' &&
              'providerName' in match.params &&
              match.params.providerName === provider.provider
          )

          return (
            <div key={index} className="flex flex-col px-2 my-1.5 ">
              <div
                className={cn(
                  'flex px-2 items-center gap-1.5 cursor-pointer hover:bg-main-view-fg/5 py-1 w-full rounded [&.active]:bg-main-view-fg/5 text-main-view-fg/80',
                  isActive && 'bg-main-view-fg/5',
                  // hidden for llama.cpp provider for setup remote provider
                  provider.provider === 'llama.cpp' &&
                    stepSetupRemoteProvider &&
                    'hidden'
                )}
                onClick={() =>
                  navigate({
                    to: route.settings.providers,
                    params: {
                      providerName: provider.provider,
                    },
                    ...(stepSetupRemoteProvider
                      ? { search: { step: 'setup_remote_provider' } }
                      : {}),
                  })
                }
              >
                <ProvidersAvatar provider={provider} />
                <div className="truncate">
                  <span>{getProviderTitle(provider.provider)}</span>
                </div>
              </div>
            </div>
          )
        })}

        <Dialog>
          <DialogTrigger asChild>
            <div className="flex cursor-pointer px-4 my-1.5 items-center gap-1.5  text-main-view-fg/80">
              <IconCirclePlus size={18} />
              <span>{t('provider:addProvider')}</span>
            </div>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('provider:addOpenAIProvider')}</DialogTitle>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-2"
                placeholder={t('provider:enterNameForProvider')}
                onKeyDown={(e) => {
                  // Prevent key from being captured by parent components
                  e.stopPropagation()
                }}
              />
              <DialogFooter className="mt-2 flex items-center">
                <DialogClose asChild>
                  <Button
                    variant="link"
                    size="sm"
                    className="hover:no-underline"
                  >
                    {t('common:cancel')}
                  </Button>
                </DialogClose>
                <DialogClose asChild>
                  <Button disabled={!name} onClick={createProvider}>
                    {t('common:create')}
                  </Button>
                </DialogClose>
              </DialogFooter>
            </DialogHeader>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  )
}

export default ProvidersMenu
