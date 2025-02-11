import React, { useEffect, useState } from 'react'

import { Button, Modal } from '@janhq/joi'

import { useAtom } from 'jotai'

import LogoMark from '../Brand/Logo/Mark'

import { appUpdateNotAvailableAtom } from '@/helpers/atoms/App.atom'

const ModalAppUpdaterNotAvailable = () => {
  const [appUpdateNotAvailable, setAppUpdateNotAvailable] = useAtom(
    appUpdateNotAvailableAtom
  )

  const [open, setOpen] = useState(appUpdateNotAvailable)

  useEffect(() => {
    setOpen(appUpdateNotAvailable)
  }, [appUpdateNotAvailable])

  return (
    <Modal
      hideClose={true}
      title={
        <>
          <div className="flex items-center gap-x-2">
            <LogoMark width={40} height={40} />
            <h6>App Update</h6>
          </div>
        </>
      }
      open={open}
      onOpenChange={() => setOpen(!open)}
      content={
        <div className="mt-3">
          <p className="mt-2 text-sm font-normal">
            You’re up to date! No new updates available
          </p>
          <div className="mt-4 flex items-center justify-end gap-x-2">
            <Button
              autoFocus
              onClick={() => {
                setOpen(false)
                setAppUpdateNotAvailable(false)
              }}
            >
              Check back later
            </Button>
          </div>
        </div>
      }
    />
  )
}

export default ModalAppUpdaterNotAvailable
