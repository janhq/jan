import React, { Fragment } from 'react'

import { Button, Checkbox, Modal, Badge } from '@janhq/joi'

import { AlertTriangleIcon } from 'lucide-react'

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
                <div className="mb-2 mt-4 rounded-lg border border-[hsla(var(--app-border))] p-3">
                  <p className="font-bold">Threads</p>
                </div>
                <div className="my-2 rounded-lg border border-[hsla(var(--app-border))] p-3">
                  <p className="font-bold">Models</p>
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
