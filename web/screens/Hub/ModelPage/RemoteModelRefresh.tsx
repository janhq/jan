import { Button } from '@janhq/joi'

import { RefreshCwIcon } from 'lucide-react'

import Spinner from '@/containers/Loader/Spinner'

import { useRefreshModelList } from '@/hooks/useEngineManagement'

function RemoteModelRefresh({ id }: { id: string }) {
  const { refreshingModels, refreshModels } = useRefreshModelList(id)

  return (
    <Button
      theme={'ghost'}
      variant={'outline'}
      className="h-7 px-2"
      onClick={() => refreshModels()}
    >
      {refreshingModels ? (
        <Spinner size={16} strokeWidth={2} className="mr-2" />
      ) : (
        <RefreshCwIcon size={16} className="mr-2" />
      )}
      Refresh
    </Button>
  )
}

export default RemoteModelRefresh
