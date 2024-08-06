import { useCallback } from 'react'

import { Button } from '@janhq/joi'
import { useAtomValue, useSetAtom } from 'jotai'

import { showMigrationModalAtom } from '@/containers/Providers/ModalMigrations'

import { toaster } from '@/containers/Toast'

import useThreads from '@/hooks/useThreads'

import { threadsAtom } from '@/helpers/atoms/Thread.atom'

const DataMigration: React.FC = () => {
  const setShowMigrationModal = useSetAtom(showMigrationModalAtom)
  const threads = useAtomValue(threadsAtom)
  const { deleteThread } = useThreads()

  const onStartMigrationClick = useCallback(() => {
    setShowMigrationModal(true)
  }, [setShowMigrationModal])

  const onCleanUpDataClick = useCallback(async () => {
    for (const thread of threads) {
      try {
        await deleteThread(thread.id)
      } catch (err) {
        console.error('Error deleting thread', err)
        toaster({
          title: 'Delete thread failed',
          description: `Failed to delete thread ${thread.title}`,
          type: 'error',
        })
      }
    }
    toaster({
      title: 'Delete thread successfully!',
      type: 'success',
    })
  }, [threads, deleteThread])

  return (
    <div className="flex w-full flex-col items-start justify-between gap-4 border-b border-[hsla(var(--app-border))] py-4 first:pt-0 last:border-none sm:flex-row">
      <div className="flex-shrink-0 space-y-1">
        <div className="flex gap-x-2">
          <h6 className="font-semibold capitalize">
            Migrate data from old version of Jan app
          </h6>
        </div>
        <p className="font-medium leading-relaxed text-[hsla(var(--text-secondary))]">
          Migrate multiple times can cause duplicate threads, please consider
          using the remove threads button to clean up existing threads data
        </p>
      </div>
      <div className="flex flex-row gap-x-2">
        <Button theme="primary" onClick={onStartMigrationClick}>
          Start migration
        </Button>
        <Button theme="destructive" onClick={onCleanUpDataClick}>
          Remove threads and messages
        </Button>
      </div>
    </div>
  )
}

export default DataMigration
