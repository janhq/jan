import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'

import { toast } from 'sonner'
import { CardItem } from '../Card'
import { EngineManager } from '@janhq/core'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useRouter } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { predefinedProviders } from '@/constants/providers'
import { useFavoriteModel } from '@/hooks/useFavoriteModel'

type Props = {
  provider?: ProviderObject
}
const DeleteProvider = ({ provider }: Props) => {
  const { t } = useTranslation()
  const { deleteProvider, providers } = useModelProvider()
  const { favoriteModels, removeFavorite } = useFavoriteModel()
  const router = useRouter()
  if (
    !provider ||
    predefinedProviders.some((e) => e.provider === provider.provider) ||
    EngineManager.instance().get(provider.provider)
  )
    return null

  const removeProvider = async () => {
    // Remove favorite models that belong to this provider
    const providerModelIds = provider.models.map((model) => model.id)
    favoriteModels.forEach((favoriteModel) => {
      if (providerModelIds.includes(favoriteModel.id)) {
        removeFavorite(favoriteModel.id)
      }
    })

    deleteProvider(provider.provider)
    toast.success(t('providers:deleteProvider.title'), {
      id: `delete-provider-${provider.provider}`,
      description: t('providers:deleteProvider.success', {
        provider: provider.provider,
      }),
    })
    setTimeout(() => {
      router.navigate({
        to: route.settings.providers,
        params: {
          providerName: providers[0].provider,
        },
      })
    }, 0)
  }

  return (
    <CardItem
      title={t('providers:deleteProvider.title')}
      description={t('providers:deleteProvider.description')}
      actions={
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="destructive" size="sm">
              {t('providers:deleteProvider.delete')}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {t('providers:deleteProvider.confirmTitle', {
                  provider: provider.provider,
                })}
              </DialogTitle>
              <DialogDescription>
                {t('providers:deleteProvider.confirmDescription')}
              </DialogDescription>
            </DialogHeader>

            <DialogFooter className="mt-2">
              <DialogClose asChild>
                <Button variant="link" size="sm" className="hover:no-underline">
                  {t('providers:deleteProvider.cancel')}
                </Button>
              </DialogClose>
              <DialogClose asChild>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={removeProvider}
                >
                  {t('providers:deleteProvider.delete')}
                </Button>
              </DialogClose>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      }
    />
  )
}
export default DeleteProvider
