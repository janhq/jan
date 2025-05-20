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
import { models } from 'token.js'
import { EngineManager } from '@janhq/core'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useRouter } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import { normalizeProvider } from '@/lib/models'

type Props = {
  provider?: ProviderObject
}
const DeleteProvider = ({ provider }: Props) => {
  const { deleteProvider, providers } = useModelProvider()
  const router = useRouter()
  if (
    !provider ||
    Object.keys(models).includes(provider.provider) ||
    EngineManager.instance().get(normalizeProvider(provider.provider))
  )
    return null

  const removeProvider = async () => {
    deleteProvider(provider.provider)
    toast.success('Delete Provider', {
      id: `delete-provider-${provider.provider}`,
      description: `Provider ${provider.provider} has been permanently deleted.`,
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
      title="Delete Provider"
      description="Delete this provider and all its models. This action cannot be undone."
      actions={
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="destructive" size="sm">
              Delete
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete Provider: {provider.provider}</DialogTitle>
              <DialogDescription>
                Are you sure you want to delete this provider? This action
                cannot be undone.
              </DialogDescription>
            </DialogHeader>

            <DialogFooter className="mt-2">
              <DialogClose asChild>
                <Button variant="link" size="sm" className="hover:no-underline">
                  Cancel
                </Button>
              </DialogClose>
              <DialogClose asChild>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={removeProvider}
                >
                  Delete
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
