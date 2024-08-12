import React, { Fragment, useCallback, useMemo, useState } from 'react'

import { Button, Modal, Badge } from '@janhq/joi'

import { useQueryClient } from '@tanstack/react-query'
import { atom, useAtom, useSetAtom } from 'jotai'
import { AlertTriangleIcon } from 'lucide-react'

import { twMerge } from 'tailwind-merge'

import Spinner from '@/containers/Loader/Spinner'

import useMigratingData from '@/hooks/useMigratingData'

import { modelQueryKey } from '@/hooks/useModelQuery'

import { didShowMigrationWarningAtom } from '@/helpers/atoms/AppConfig.atom'

export const showMigrationModalAtom = atom<boolean>(false)

const MigrationStates = ['idle', 'in_progress', 'failed', 'success'] as const
type MigrationState = (typeof MigrationStates)[number]

const ModalMigrations = () => {
  const setDidShowMigrationModal = useSetAtom(didShowMigrationWarningAtom)
  const [showMigrationModal, setShowMigrationModal] = useAtom(
    showMigrationModalAtom
  )
  const [step, setStep] = React.useState(1)
  const { migrateModels, migrateThreadsAndMessages } = useMigratingData()
  const [threadAndMessageMigrationState, setThreadAndMessageMigrationState] =
    useState<MigrationState>('idle')
  const [modelMigrationState, setModelMigrationState] =
    useState<MigrationState>('idle')
  const queryClient = useQueryClient()

  const getStepTitle = () => {
    switch (step) {
      case 1:
        return 'Important Update: Data Migration Needed'

      default:
        return threadAndMessageMigrationState === 'in_progress' ||
          modelMigrationState === 'in_progress'
          ? 'Migrating'
          : 'Migration Completed'
    }
  }

  const migrationThreadsAndMessages = useCallback(async () => {
    setThreadAndMessageMigrationState('in_progress')
    try {
      await migrateThreadsAndMessages()
      setThreadAndMessageMigrationState('success')
      console.debug('Migrating threads and messages successfully!')
    } catch (err) {
      console.error('Migrating threads and messages error', err)
      setThreadAndMessageMigrationState('failed')
    }
  }, [setThreadAndMessageMigrationState, migrateThreadsAndMessages])

  const migratingModels = useCallback(async () => {
    setModelMigrationState('in_progress')
    try {
      await migrateModels()
      setModelMigrationState('success')
      console.debug('Migrating models successfully!')
    } catch (err) {
      console.error('Migrating models error', err)
      setModelMigrationState('failed')
    }
  }, [migrateModels, setModelMigrationState])

  const onStartMigrationClick = useCallback(async () => {
    setStep(2)
    await migratingModels()
    await migrationThreadsAndMessages()
    queryClient.invalidateQueries({ queryKey: modelQueryKey })
  }, [migratingModels, migrationThreadsAndMessages, queryClient])

  const onDismiss = useCallback(() => {
    setStep(1)
    setShowMigrationModal(false)
    setDidShowMigrationModal(true)
  }, [setDidShowMigrationModal, setShowMigrationModal])

  const disableDismissButton = useMemo(
    () =>
      threadAndMessageMigrationState === 'in_progress' ||
      modelMigrationState === 'in_progress',
    [threadAndMessageMigrationState, modelMigrationState]
  )

  return (
    <Modal
      open={showMigrationModal}
      hideClose
      title={getStepTitle()}
      content={
        <Fragment>
          {step === 1 && (
            <Fragment>
              <p className="text-[hsla(var(--text-secondary))]">
                {`We've made some exciting improvements to the app, but we need your
              help to update your data.`}
              </p>
              <div className="mt-4">
                <div className="flex items-center gap-x-1">
                  <AlertTriangleIcon
                    size={16}
                    className="text-[hsla(var(--warning-bg))]"
                  />
                  <p className="font-medium">What to expect:</p>
                </div>

                <div className="mt-2">
                  <ul className="list-disc rounded-lg bg-[hsla(var(--warning-bg-soft))] p-4 pl-8">
                    <li>
                      <span>
                        Some threads or models{' '}
                        <span className="font-bold">might be</span> missing
                        after the migration.
                      </span>
                    </li>
                    <li>
                      <span>
                        This will take a few seconds and reload the app.
                      </span>
                    </li>
                  </ul>
                </div>
              </div>

              <div className="flex justify-end">
                <Button className="mt-4" theme="ghost" onClick={onDismiss}>
                  Skip
                </Button>
                <Button className="ml-2 mt-4" onClick={onStartMigrationClick}>
                  Migrate Now
                </Button>
              </div>
            </Fragment>
          )}
          {step === 2 && (
            <Fragment>
              <div
                className={twMerge(
                  'mb-2 mt-4 flex justify-between rounded-lg border border-[hsla(var(--app-border))] p-3',
                  threadAndMessageMigrationState === 'success'
                    ? 'bg-[hsla(var(--success-bg-soft))]'
                    : 'bg-[hsla(var(--destructive-bg-soft))]',
                  threadAndMessageMigrationState === 'in_progress' &&
                    'bg-trasparent'
                )}
              >
                <div className="flex items-center gap-x-1.5">
                  {threadAndMessageMigrationState !== 'in_progress' && (
                    <>
                      {threadAndMessageMigrationState === 'success' ? (
                        <Badge theme="success">Success</Badge>
                      ) : (
                        <Badge theme="destructive">Failed</Badge>
                      )}
                    </>
                  )}
                  <p className="font-bold">Threads</p>
                </div>
                {threadAndMessageMigrationState === 'in_progress' ? (
                  <Spinner />
                ) : (
                  threadAndMessageMigrationState !== 'success' && (
                    <Button
                      size="small"
                      theme="ghost"
                      onClick={migrateThreadsAndMessages}
                    >
                      Retry
                    </Button>
                  )
                )}
              </div>
              <div
                className={twMerge(
                  'my-2 flex justify-between rounded-lg border border-[hsla(var(--app-border))] p-3',
                  modelMigrationState === 'success'
                    ? 'bg-[hsla(var(--success-bg-soft))]'
                    : 'bg-[hsla(var(--destructive-bg-soft))]',
                  modelMigrationState === 'in_progress' && 'bg-trasparent'
                )}
              >
                <div className="flex items-center gap-x-1.5">
                  {modelMigrationState !== 'in_progress' && (
                    <>
                      {modelMigrationState === 'success' ? (
                        <Badge theme="success">Success</Badge>
                      ) : (
                        <Badge theme="destructive">Failed</Badge>
                      )}
                    </>
                  )}
                  <p className="font-bold">Models</p>
                </div>
                {modelMigrationState === 'in_progress' ? (
                  <Spinner />
                ) : (
                  modelMigrationState === 'failed' && (
                    <Button
                      size="small"
                      theme="ghost"
                      onClick={migratingModels}
                    >
                      Retry
                    </Button>
                  )
                )}
              </div>
              <div className="flex justify-end">
                <Button
                  className="mt-2"
                  disabled={disableDismissButton}
                  onClick={onDismiss}
                >
                  Done
                </Button>
              </div>
            </Fragment>
          )}
        </Fragment>
      }
    />
  )
}

export default ModalMigrations
