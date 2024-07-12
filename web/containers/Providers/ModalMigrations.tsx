/* eslint-disable @typescript-eslint/no-explicit-any */

import React, { Fragment, useCallback, useEffect } from 'react'

import { Button, Modal, Badge } from '@janhq/joi'

import { useAtom, useAtomValue } from 'jotai'
import { AlertTriangleIcon } from 'lucide-react'

import { twMerge } from 'tailwind-merge'

import Spinner from '@/containers/Loader/Spinner'

import useMigratingData from '@/hooks/useMigratingData'

import {
  didShowMigrationWarningAtom,
  modelsMigrationSuccessAtom,
  threadsMessagesMigrationSuccessAtom,
  skipMigrationAtom,
} from '@/helpers/atoms/AppConfig.atom'

const ModalMigrations = ({ children }: React.PropsWithChildren) => {
  const [didShowMigrationWarning, setDidShowMigrationWarning] = useAtom(
    didShowMigrationWarningAtom
  )
  const [skipMigration, setSkipMigration] = useAtom(skipMigrationAtom)
  const modelsMigrationSuccess = useAtomValue(modelsMigrationSuccessAtom)
  const threadsMessagesMigrationSuccess = useAtomValue(
    threadsMessagesMigrationSuccessAtom
  )

  const [step, setStep] = React.useState(1)
  const [loaderThreads, setLoaderThreads] = React.useState(false)
  const [loaderModels, setLoaderModels] = React.useState(false)
  const [threadsAndMessages, setThreadsAndMessages] = React.useState({})

  const getStepTitle = () => {
    switch (step) {
      case 1:
        return 'Important Update: Data Migration Needed'

      default:
        return loaderThreads || loaderModels
          ? 'Migration In Progressed'
          : 'Migration Completed'
    }
  }

  const handleStartMigration = async () => {
    setStep(2)
    await handleStartMigrationModels()
    await handleStartMigrationThreads()
  }

  const handleStartMigrationThreads = async () => {
    setLoaderThreads(true)
    await migrateThreadsAndMessages()
    setTimeout(() => {
      setLoaderThreads(false)
    }, 1200)
  }

  const handleStartMigrationModels = async () => {
    setLoaderModels(true)
    await migrateModels()
    setTimeout(() => {
      setLoaderModels(false)
    }, 1200)
  }

  const { getJanThreadsAndMessages, migrateModels, migrateThreadsAndMessages } =
    useMigratingData()

  const getMigrationNotif = useCallback(async () => {
    try {
      const result = await getJanThreadsAndMessages()
      setThreadsAndMessages(result)
    } catch (error) {
      setThreadsAndMessages({ threads: [], messages: [] })
      setDidShowMigrationWarning(false)
      console.error(error)
    }
    return threadsAndMessages
  }, [getJanThreadsAndMessages, setDidShowMigrationWarning, threadsAndMessages])

  useEffect(() => {
    getMigrationNotif()

    if (skipMigration) {
      setDidShowMigrationWarning(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skipMigration, setSkipMigration, setDidShowMigrationWarning])

  return (
    <>
      <Modal
        open={didShowMigrationWarning}
        hideClose
        title={getStepTitle()}
        content={
          <>
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
                  <Button
                    className="mt-4"
                    theme="ghost"
                    onClick={() => setSkipMigration(true)}
                  >
                    Skip
                  </Button>
                  <Button
                    className="ml-2 mt-4"
                    onClick={() => handleStartMigration()}
                  >
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
                    threadsMessagesMigrationSuccess
                      ? 'bg-[hsla(var(--success-bg-soft))]'
                      : 'bg-[hsla(var(--destructive-bg-soft))]',
                    loaderThreads && 'bg-trasparent'
                  )}
                >
                  <div className="flex items-center gap-x-1.5">
                    {!loaderThreads && (
                      <>
                        {threadsMessagesMigrationSuccess ? (
                          <Badge theme="success">Success</Badge>
                        ) : (
                          <Badge theme="destructive">Failed</Badge>
                        )}
                      </>
                    )}
                    <p className="font-bold">Threads</p>
                  </div>
                  {loaderThreads ? (
                    <Spinner />
                  ) : (
                    !threadsMessagesMigrationSuccess && (
                      <Button
                        size="small"
                        theme="ghost"
                        onClick={() => handleStartMigrationThreads()}
                      >
                        Retry
                      </Button>
                    )
                  )}
                </div>
                <div
                  className={twMerge(
                    'my-2 flex justify-between rounded-lg border border-[hsla(var(--app-border))] p-3',
                    modelsMigrationSuccess
                      ? 'bg-[hsla(var(--success-bg-soft))]'
                      : 'bg-[hsla(var(--destructive-bg-soft))]',
                    loaderModels && 'bg-trasparent'
                  )}
                >
                  <div className="flex items-center gap-x-1.5">
                    {!loaderModels && (
                      <>
                        {modelsMigrationSuccess ? (
                          <Badge theme="success">Success</Badge>
                        ) : (
                          <Badge theme="destructive">Failed</Badge>
                        )}
                      </>
                    )}
                    <p className="font-bold">Models</p>
                  </div>
                  {loaderModels ? (
                    <Spinner />
                  ) : (
                    !modelsMigrationSuccess && (
                      <Button
                        size="small"
                        theme="ghost"
                        onClick={() => handleStartMigrationModels()}
                      >
                        Retry
                      </Button>
                    )
                  )}
                </div>
                <div className="flex justify-end">
                  <Button
                    className="mt-2"
                    onClick={() => {
                      setDidShowMigrationWarning(false)
                    }}
                  >
                    Done
                  </Button>
                </div>
              </Fragment>
            )}
          </>
        }
      />
      {children}
    </>
  )
}

export default ModalMigrations
