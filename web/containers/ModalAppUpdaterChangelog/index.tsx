import React, { useEffect, useState } from 'react'

import { Button, Modal } from '@janhq/joi'

import { useAtom } from 'jotai'

import { useGetLatestRelease } from '@/hooks/useGetLatestRelease'

import { MarkdownTextMessage } from '@/screens/Thread/ThreadCenterPanel/TextMessage/MarkdownTextMessage'

import LogoMark from '../Brand/Logo/Mark'

import { appUpdateAvailableAtom } from '@/helpers/atoms/App.atom'

const ModalAppUpdaterChangelog = () => {
  const [appUpdateAvailable, setAppUpdateAvailable] = useAtom(
    appUpdateAvailableAtom
  )

  const [open, setOpen] = useState(appUpdateAvailable)

  useEffect(() => {
    setOpen(appUpdateAvailable)
  }, [appUpdateAvailable])

  const beta = VERSION.includes('beta')
  const nightly = VERSION.includes('-')

  const { release } = useGetLatestRelease(beta ? true : false)

  return (
    <Modal
      hideClose={true}
      title={
        <>
          <div className="flex items-center gap-x-2">
            <LogoMark width={40} height={40} />
            <h6>App Update</h6>
          </div>
          {!nightly && (
            <p className="mt-2 text-sm font-normal">
              Version <b>{release?.name}</b> is available and ready to install.
            </p>
          )}
        </>
      }
      open={open}
      onOpenChange={() => setOpen(!open)}
      content={
        <div className="mt-3">
          {nightly ? (
            <p className="mt-2 text-sm font-normal">
              You are using a nightly build. This version is built from the
              latest development branch and may not have release notes.
            </p>
          ) : (
            <>
              <div className="markdown-content max-h-[400px] overflow-y-auto rounded-lg border border-[hsla(var(--app-border))] px-2 pb-4 pt-0">
                <MarkdownTextMessage text={release?.body} />
              </div>
            </>
          )}
          <div className="mt-4 flex items-center justify-end gap-x-2">
            <Button
              theme="ghost"
              variant="outline"
              onClick={() => {
                setOpen(false)
                setAppUpdateAvailable(false)
              }}
            >
              Later
            </Button>
            <Button
              autoFocus
              onClick={() => {
                window.core?.api?.appUpdateDownload()
                setOpen(false)
                setAppUpdateAvailable(false)
              }}
            >
              Update Now
            </Button>
          </div>
        </div>
      }
    />
  )
}

export default ModalAppUpdaterChangelog
