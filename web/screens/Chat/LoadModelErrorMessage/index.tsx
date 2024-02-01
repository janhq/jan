import { MessageStatus, ThreadMessage } from '@janhq/core'
import { useAtomValue } from 'jotai'

import { useActiveModel } from '@/hooks/useActiveModel'

import { totalRamAtom } from '@/helpers/atoms/SystemBar.atom'

const LoadModelErrorMessage = () => {
  const { activeModel } = useActiveModel()
  const availableRam = useAtomValue(totalRamAtom)

  return (
    <>
      <div className="mt-10 flex flex-col items-center">
        <span className="mb-3 text-center text-sm font-medium text-gray-500">
          {Number(activeModel?.metadata.size) > availableRam ? (
            <>
              Oops! Model size exceeds available RAM. Consider selecting a
              smaller model or upgrading your RAM for smoother performance.
            </>
          ) : (
            <>
              <p>Apologies, something&apos;s amiss!</p>
              Jan&apos;s in beta. Find troubleshooting guides{' '}
              <a
                href="https://jan.ai/guides/troubleshooting"
                target="_blank"
                className="text-blue-600 hover:underline dark:text-blue-300"
              >
                here
              </a>{' '}
              or reach out to us on{' '}
              <a
                href="https://discord.gg/AsJ8krTT3N"
                target="_blank"
                className="text-blue-600 hover:underline dark:text-blue-300"
              >
                Discord
              </a>{' '}
              for assistance.
            </>
          )}
        </span>
      </div>
    </>
  )
}
export default LoadModelErrorMessage
