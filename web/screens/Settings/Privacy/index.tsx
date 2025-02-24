import { fs } from '@janhq/core'
import { Button, Input, ScrollArea, Switch } from '@janhq/joi'
import { useAtom, useAtomValue } from 'jotai'
import { FolderOpenIcon } from 'lucide-react'

import posthog from 'posthog-js'

import { toaster } from '@/containers/Toast'

import { usePath } from '@/hooks/usePath'

import { janDataFolderPathAtom } from '@/helpers/atoms/AppConfig.atom'
import {
  productAnalyticAtom,
  showScrollBarAtom,
} from '@/helpers/atoms/Setting.atom'

const Privacy = () => {
  /**
   * Clear logs
   * @returns
   */
  const clearLogs = async () => {
    try {
      await fs.rm(`file://logs`)
    } catch (err) {
      console.error('Error clearing logs: ', err)
    }

    toaster({
      title: 'Logs cleared',
      description: 'All logs have been cleared.',
      type: 'success',
    })
  }
  const showScrollBar = useAtomValue(showScrollBarAtom)
  const janDataFolderPath = useAtomValue(janDataFolderPathAtom)
  const { onRevealInFinder } = usePath()
  const [productAnalytic, setProductAnalytic] = useAtom(productAnalyticAtom)

  return (
    <ScrollArea
      type={showScrollBar ? 'always' : 'scroll'}
      className="h-full w-full px-4"
    >
      <div className="mb-4 mt-8 rounded-xl bg-[hsla(var(--tertiary-bg))] px-4 py-2 text-[hsla(var(--text-secondary))]">
        <p>
          We prioritize your control over your data. Learn more about our&nbsp;
          <a
            href="https://jan.ai/docs/privacy"
            target="_blank"
            className="text-[hsla(var(--app-link))]"
          >
            Privacy Policy.
          </a>
        </p>
        <br />
        <p>
          To make Jan better, we need to understand how it’s used - but only if
          you choose to help. You can change your Jan Analytics settings
          anytime.
        </p>
        <br />
        <p>
          {`Your choice to opt-in or out doesn't change our core privacy promises:`}
        </p>
        <ul className="list-inside list-disc pl-4">
          <li>Your chats are never read</li>
          <li>No personal information is collected</li>
          <li>No accounts or logins required</li>
          <li>We don’t access your files</li>
          <li>Your chat history and settings stay on your device</li>
        </ul>
      </div>
      <div className="block w-full py-4">
        {/* Analytic */}
        <div className="flex w-full flex-col justify-between gap-x-20 gap-y-4 border-b border-[hsla(var(--app-border))] py-4 first:pt-0 last:border-none sm:flex-row sm:items-center">
          <div className="space-y-1">
            <div className="flex gap-x-2">
              <h6 className="font-semibold capitalize">Analytics</h6>
            </div>
            <p className="font-medium leading-relaxed text-[hsla(var(--text-secondary))]">
              By opting in, you help us make Jan better by sharing anonymous
              data, like feature usage and user counts. Your chats and personal
              information are never collected.
            </p>
          </div>
          <div className="flex-shrink-0">
            <Switch
              checked={productAnalytic}
              onChange={(e) => {
                if (e.target.checked) {
                  posthog.opt_in_capturing()
                } else {
                  posthog.capture('user_opt_out', { timestamp: new Date() })
                  posthog.opt_out_capturing()
                }
                setProductAnalytic(e.target.checked)
              }}
            />
          </div>
        </div>

        {/* Logs */}

        <div className="flex w-full flex-col items-start justify-between gap-4 border-b border-[hsla(var(--app-border))] py-4 first:pt-0 last:border-none sm:flex-row">
          <div className="space-y-1">
            <div className="flex gap-x-2">
              <h6 className="font-semibold capitalize">Logs</h6>
            </div>
            <p className="font-medium leading-relaxed text-[hsla(var(--text-secondary))]">
              Open App Logs and Cortex Logs.
            </p>
          </div>
          <div className="flex items-center gap-x-3">
            <div className="relative">
              <Input
                data-testid="jan-data-folder-input"
                value={janDataFolderPath + '/logs'}
                className="w-full pr-8 sm:w-[240px]"
                disabled
              />
              <FolderOpenIcon
                size={16}
                className="absolute right-2 top-1/2 z-10 -translate-y-1/2 cursor-pointer"
                onClick={() => onRevealInFinder('Logs')}
              />
            </div>
          </div>
        </div>

        {/* Clear log */}
        <div className="flex w-full flex-col items-start justify-between gap-4 border-b border-[hsla(var(--app-border))] py-4 first:pt-0 last:border-none sm:flex-row">
          <div className="flex-shrink-0 space-y-1">
            <div className="flex gap-x-2">
              <h6 className="font-semibold capitalize">Clear logs</h6>
            </div>
            <p className="font-medium leading-relaxed text-[hsla(var(--text-secondary))]">
              Clear all logs from Jan app.
            </p>
          </div>
          <Button
            data-testid="clear-logs"
            theme="destructive"
            variant="soft"
            onClick={clearLogs}
          >
            Clear
          </Button>
        </div>
      </div>
    </ScrollArea>
  )
}

export default Privacy
