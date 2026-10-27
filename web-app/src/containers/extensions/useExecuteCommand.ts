import { useCallback } from 'react'
import { toast } from 'sonner'
import type { CommandContext } from '@janhq/extension-api'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { getExtensionHost } from '@/lib/extensions/host'
import { own, useContributions } from '@/lib/extensions/contributions'
import { localize } from '@/lib/extensions/l10n'

/**
 * Runs a contributed command from host UI. A failure never reaches the
 * caller: it is logged and shown as a toast naming the command and its
 * extension, so a broken extension cannot break the menu that ran it.
 */
export function useExecuteCommand() {
  const { t } = useTranslation()
  return useCallback(
    async (
      extensionId: string,
      commandId: string,
      context: CommandContext
    ): Promise<void> => {
      try {
        await getExtensionHost().contributions.executeCommand(
          extensionId,
          commandId,
          context
        )
      } catch (error) {
        console.error(
          `Command '${commandId}' of '${extensionId}' failed:`,
          error
        )
        const state = useContributions.getState()
        const extension = own(state.extensions, extensionId)
        const title = own(own(state.commands, extensionId), commandId)?.title
        toast.error(
          t('extensions:commandFailed', {
            command: title === undefined ? commandId : localize(extension, title),
            extension: extension
              ? localize(extension, extension.displayName)
              : extensionId,
          }),
          {
            description: error instanceof Error ? error.message : String(error),
          }
        )
      }
    },
    [t]
  )
}
