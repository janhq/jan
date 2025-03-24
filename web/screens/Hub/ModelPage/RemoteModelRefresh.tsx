import { Button } from '@janhq/joi'

import { RefreshCwIcon } from 'lucide-react'

import Spinner from '@/containers/Loader/Spinner'

import { useRefreshModelList } from '@/hooks/useEngineManagement'

function RemoteModelRefresh({ engine }: { engine: string }) {
  const { refreshingModels, refreshModels } = useRefreshModelList(engine)

  return (
    <Button
      theme={'ghost'}
      variant={'outline'}
      className="h-7 px-2"
      onClick={() => refreshModels(engine)}
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
