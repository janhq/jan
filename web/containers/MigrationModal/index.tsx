import React, { useCallback, useMemo, useState } from 'react'

import { Modal } from '@janhq/joi'

import { useQueryClient } from '@tanstack/react-query'
import { atom, useAtom, useAtomValue, useSetAtom } from 'jotai'

import useMigratingData from '@/hooks/useMigratingData'

import MigrationInProgressContainer from './components/MigrationInProgressContainer'

import MigrationIntroContainer from './components/MigrationIntroContainer'

import { didShowMigrationWarningAtom } from '@/helpers/atoms/AppConfig.atom'
import {
  initMigrationAtom,
  migrationProgressStatusListAtom,
  MigrationType,
} from '@/helpers/atoms/Migration.atom'
import { modelQueryKey } from '@/hooks/useModelQuery'

export const showMigrationModalAtom = atom<boolean>(false)

const MigrationStages = ['intro', 'migrating'] as const
type MigrationStage = (typeof MigrationStages)[number]

const MigrationModal: React.FC = () => {
  const setDidShowMigrationModal = useSetAtom(didShowMigrationWarningAtom)
  const [showMigrationModal, setShowMigrationModal] = useAtom(
    showMigrationModalAtom
  )
  const migrationProgressStatusList = useAtomValue(
    migrationProgressStatusListAtom
  )
  const initMigration = useSetAtom(initMigrationAtom)

  const [stage, setStage] = useState<MigrationStage>('intro')
  const {
    migrateModels,
    migrateThreadsAndMessages,
    initializeEngineSync,
    migrateApiKeys,
  } = useMigratingData()
  const queryClient = useQueryClient()

  const onStartMigrationClick = useCallback(async () => {
    setStage('migrating')
    initMigration()
    await migrateModels()
    queryClient.invalidateQueries({ queryKey: modelQueryKey })
    await migrateThreadsAndMessages()
    await initializeEngineSync()
    await migrateApiKeys()
  }, [
    migrateModels,
    queryClient,
    initMigration,
    migrateThreadsAndMessages,
    initializeEngineSync,
    migrateApiKeys,
  ])

  const onRetryClicked = useCallback((migrationType: MigrationType) => {
    // TODO: implement this
  }, [])

  const onDismiss = useCallback(() => {
    setStage('intro')
    setShowMigrationModal(false)
    setDidShowMigrationModal(true)
  }, [setDidShowMigrationModal, setShowMigrationModal])

  const modalTitle = useMemo(() => {
    if (stage === 'intro') return 'Jan just got supercharged! 🎉'
    if (
      migrationProgressStatusList.some((status) =>
        ['in_progress', 'idle'].includes(status.state)
      )
    )
      return 'Migration In Progress'
    return 'Migration Completed'
  }, [stage, migrationProgressStatusList])

  return (
    <Modal
      open={showMigrationModal}
      onOpenChange={onDismiss}
      title={modalTitle}
      content=<Content
        stage={stage}
        onMigrateNowClick={onStartMigrationClick}
        onRetryClick={onRetryClicked}
      />
    />
  )
}

type ContentProps = {
  stage: MigrationStage
  onMigrateNowClick: () => void
  onRetryClick: (migrationType: MigrationType) => void
}

const Content: React.FC<ContentProps> = ({
  stage,
  onMigrateNowClick,
  onRetryClick,
}) => {
  if (stage === 'migrating')
    return <MigrationInProgressContainer onRetryClicked={onRetryClick} />
  return <MigrationIntroContainer onMigrateNowClick={onMigrateNowClick} />
}

export default MigrationModal
