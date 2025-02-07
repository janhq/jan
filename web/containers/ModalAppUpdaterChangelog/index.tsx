import { Button, Modal } from '@janhq/joi'
import React, { useState } from 'react'
import LogoMark from '../Brand/Logo/Mark'
import { useGetLatestRelease } from '@/hooks/useGetLatestRelease'
import { MarkdownTextMessage } from '@/screens/Thread/ThreadCenterPanel/TextMessage/MarkdownTextMessage'

const ModalAppUpdaterChangelog = () => {
  const [open, setOpen] = useState(true)
  const { release } = useGetLatestRelease()

  return (
    <Modal
      title={
        <>
          <div className="flex items-center gap-x-2">
            <LogoMark width={40} height={40} />
            <h6>App Update</h6>
          </div>
          <p className="mt-2 text-sm font-normal">
            Version <b>{release?.name}</b> is available and ready to install.{' '}
          </p>
        </>
      }
      open={open}
      onOpenChange={() => setOpen(!open)}
      content={
        <div className="mt-3">
          <div className="max-h-200px markdown-content overflow-y-auto rounded-lg border border-[hsla(var(--app-border))] px-2 pb-4 pt-0">
            <MarkdownTextMessage text={release?.body} />
          </div>
          <div className="mt-4 flex items-center justify-end gap-x-2">
            <Button
              theme="ghost"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Later
            </Button>
            <Button autoFocus>Update Now</Button>
          </div>
        </div>
      }
    />
  )
}

export default ModalAppUpdaterChangelog
