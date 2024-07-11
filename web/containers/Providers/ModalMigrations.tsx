import React, { Fragment, useCallback } from 'react'

import { Button, Checkbox, Modal, Badge } from '@janhq/joi'

import { AlertTriangleIcon } from 'lucide-react'

import useMigratingData from '@/hooks/useMigratingData'

const ModalMigrations = ({ children }: React.PropsWithChildren) => {
  const [open, setOpen] = React.useState(false)
  const [step, setStep] = React.useState(1)

  const getStepTitle = () => {
    switch (step) {
      case 1:
        return 'Important Update: Data Migration Needed'

      case 3:
        return 'Migration Completed'

      default:
        return 'Migration In Progressed'
    }
  }

  const handleStartMigration = () => {
    setStep(2)
  }

  const { getJanThreadsAndMessages } = useMigratingData()

  const test = async () => await getJanThreadsAndMessages()

  // console.log(test())

  const tos = useCallback(async (): Promise<{
    messages: any[]
    threads: any[]
  }> => {
    return window?.electronAPI?.getAllMessagesAndThreads()
  }, [])

  console.log(tos())

  return (
    <>
      <Modal
        open={open}
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
                    onClick={() => handleStartMigration()}
                  >
                    Migrate Now
                  </Button>
                </div>
              </Fragment>
            )}
            {step === 2 && (
              <Fragment>
                <div className="mb-2 mt-4 flex justify-between rounded-lg border border-[hsla(var(--app-border))] p-3">
                  <p className="font-bold">Threads</p>
                  <div role="status">
                    <svg
                      aria-hidden="true"
                      className="inline h-4 w-4 animate-spin fill-[hsla(var(--primary-bg))] text-[hsla(var(--text-quaternary))]"
                      viewBox="0 0 100 101"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path
                        d="M100 50.5908C100 78.2051 77.6142 100.591 50 100.591C22.3858 100.591 0 78.2051 0 50.5908C0 22.9766 22.3858 0.59082 50 0.59082C77.6142 0.59082 100 22.9766 100 50.5908ZM9.08144 50.5908C9.08144 73.1895 27.4013 91.5094 50 91.5094C72.5987 91.5094 90.9186 73.1895 90.9186 50.5908C90.9186 27.9921 72.5987 9.67226 50 9.67226C27.4013 9.67226 9.08144 27.9921 9.08144 50.5908Z"
                        fill="currentColor"
                      />
                      <path
                        d="M93.9676 39.0409C96.393 38.4038 97.8624 35.9116 97.0079 33.5539C95.2932 28.8227 92.871 24.3692 89.8167 20.348C85.8452 15.1192 80.8826 10.7238 75.2124 7.41289C69.5422 4.10194 63.2754 1.94025 56.7698 1.05124C51.7666 0.367541 46.6976 0.446843 41.7345 1.27873C39.2613 1.69328 37.813 4.19778 38.4501 6.62326C39.0873 9.04874 41.5694 10.4717 44.0505 10.1071C47.8511 9.54855 51.7191 9.52689 55.5402 10.0491C60.8642 10.7766 65.9928 12.5457 70.6331 15.2552C75.2735 17.9648 79.3347 21.5619 82.5849 25.841C84.9175 28.9121 86.7997 32.2913 88.1811 35.8758C89.083 38.2158 91.5421 39.6781 93.9676 39.0409Z"
                        fill="currentFill"
                      />
                    </svg>
                    <span className="sr-only">Loading...</span>
                  </div>
                </div>
                <div className="my-2 flex justify-between rounded-lg border border-[hsla(var(--app-border))] p-3">
                  <p className="font-bold">Models</p>
                  <div role="status">
                    <svg
                      aria-hidden="true"
                      className="inline h-4 w-4 animate-spin fill-[hsla(var(--primary-bg))] text-[hsla(var(--text-quaternary))]"
                      viewBox="0 0 100 101"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path
                        d="M100 50.5908C100 78.2051 77.6142 100.591 50 100.591C22.3858 100.591 0 78.2051 0 50.5908C0 22.9766 22.3858 0.59082 50 0.59082C77.6142 0.59082 100 22.9766 100 50.5908ZM9.08144 50.5908C9.08144 73.1895 27.4013 91.5094 50 91.5094C72.5987 91.5094 90.9186 73.1895 90.9186 50.5908C90.9186 27.9921 72.5987 9.67226 50 9.67226C27.4013 9.67226 9.08144 27.9921 9.08144 50.5908Z"
                        fill="currentColor"
                      />
                      <path
                        d="M93.9676 39.0409C96.393 38.4038 97.8624 35.9116 97.0079 33.5539C95.2932 28.8227 92.871 24.3692 89.8167 20.348C85.8452 15.1192 80.8826 10.7238 75.2124 7.41289C69.5422 4.10194 63.2754 1.94025 56.7698 1.05124C51.7666 0.367541 46.6976 0.446843 41.7345 1.27873C39.2613 1.69328 37.813 4.19778 38.4501 6.62326C39.0873 9.04874 41.5694 10.4717 44.0505 10.1071C47.8511 9.54855 51.7191 9.52689 55.5402 10.0491C60.8642 10.7766 65.9928 12.5457 70.6331 15.2552C75.2735 17.9648 79.3347 21.5619 82.5849 25.841C84.9175 28.9121 86.7997 32.2913 88.1811 35.8758C89.083 38.2158 91.5421 39.6781 93.9676 39.0409Z"
                        fill="currentFill"
                      />
                    </svg>
                    <span className="sr-only">Loading...</span>
                  </div>
                </div>
              </Fragment>
            )}
            {step === 3 && (
              <Fragment>
                <div className="mb-2 mt-4 flex justify-between rounded-lg border border-[hsla(var(--app-border))] p-3">
                  <p className="font-bold">Threads</p>
                  <Checkbox checked />
                </div>
                <div className="my-2 flex justify-between rounded-lg border border-[hsla(var(--app-border))] bg-[hsla(var(--destructive-bg-soft))] p-3">
                  <div className="flex items-center gap-x-1">
                    <Badge theme="destructive">Failed</Badge>
                    <p className="font-bold">Models</p>
                  </div>
                  <Button size="small" theme="ghost">
                    Retry
                  </Button>
                </div>

                <div className="flex justify-end">
                  <Button className="mt-2" onClick={() => setOpen(false)}>
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
