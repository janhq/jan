import { useMemo } from 'react'
import type {
  CommandContext,
  MenuLocation,
  WhenClause,
} from '@janhq/extension-api'
import { own, useContributions } from '@/lib/extensions/contributions'
import { useLocalize } from '@/lib/extensions/l10n'
import { useMessages } from '@/hooks/useMessages'

/** One contributed menu entry, resolved against its command and extension. */
export interface ContributedMenuItem {
  extensionId: string
  extensionName: string
  commandId: string
  title: string
  category?: string
  group?: string
  order?: number
}

/** The context a menu at `location` hands to the commands it runs. */
export type MenuContext<L extends MenuLocation> = Extract<
  CommandContext,
  { location: L }
>

const threadIdOf = (context: CommandContext): string | undefined =>
  'threadId' in context ? context.threadId : undefined

function matches(
  when: WhenClause | undefined,
  context: CommandContext,
  hasMessages: boolean
): boolean {
  switch (when) {
    case undefined:
    case 'always':
      return true
    case 'message.role == assistant':
      return (
        context.location === 'message/actions' && context.role === 'assistant'
      )
    case 'message.role == user':
      return context.location === 'message/actions' && context.role === 'user'
    case 'thread.hasMessages':
      return hasMessages
  }
}

const compare = (a: ContributedMenuItem, b: ContributedMenuItem) =>
  (a.group ?? '').localeCompare(b.group ?? '') ||
  (a.order ?? 0) - (b.order ?? 0) ||
  a.title.localeCompare(b.title)

/**
 * The entries every extension contributed to `location` whose `when` clause
 * holds in `context`, sorted by group, order and title.
 */
export function useContributedMenuItems<L extends MenuLocation>(
  location: L,
  menuContext: MenuContext<L>
): ContributedMenuItem[] {
  const context: CommandContext = menuContext
  // Select the stable slices and derive in a memo: a selector building a new
  // array would re-render on every store change.
  const extensions = useContributions((s) => s.extensions)
  const menus = useContributions((s) => s.menus)
  const commands = useContributions((s) => s.commands)
  const localize = useLocalize()
  const threadId = threadIdOf(context)
  const threadHasMessages = useMessages((s) =>
    threadId ? (s.messages[threadId]?.length ?? 0) > 0 : false
  )
  // A message menu is by definition on a thread that has one.
  const hasMessages =
    context.location === 'message/actions' || threadHasMessages

  const resolved = useMemo(
    () =>
      Object.entries(menus)
        .flatMap(([extensionId, byLocation]) =>
          (byLocation[location] ?? []).flatMap((item) => {
            const command = own(own(commands, extensionId), item.command)
            const extension = extensions[extensionId]
            if (!command || !extension) return []
            return [
              {
                when: item.when,
                item: {
                  extensionId,
                  extensionName: localize(extension, extension.displayName),
                  commandId: command.id,
                  title: localize(extension, command.title),
                  category:
                    command.category === undefined
                      ? undefined
                      : localize(extension, command.category),
                  group: item.group,
                  order: item.order,
                },
              },
            ]
          })
        )
        .sort((a, b) => compare(a.item, b.item)),
    [menus, commands, extensions, location, localize]
  )

  return resolved
    .filter(({ when }) => matches(when, context, hasMessages))
    .map(({ item }) => item)
}
