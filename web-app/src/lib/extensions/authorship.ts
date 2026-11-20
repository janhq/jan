/**
 * The message metadata key naming the third-party extension that wrote a
 * message: one appended through `ctx.conversations.appendMessage`, or a
 * reply streamed by a provider the extension contributed. Such a message is
 * rendered without remote images or favicons: the app's img-src allows any
 * https host, so an image would let the extension reach a host it holds no
 * `network:` grant for. Built-ins never stamp it.
 */
export const EXTENSION_AUTHOR_KEY = 'extensionAuthor'

export type ExtensionAuthorMetadata = { [EXTENSION_AUTHOR_KEY]: string }

/** The extension id a message's metadata names as its author, if any. */
export function extensionAuthorOf(metadata: unknown): string | undefined {
  if (!metadata || typeof metadata !== 'object') return undefined
  const author = (metadata as Record<string, unknown>)[EXTENSION_AUTHOR_KEY]
  return typeof author === 'string' && author !== '' ? author : undefined
}

/** The stamp for a message written by `extensionId`. */
export const extensionAuthorMetadata = (
  extensionId: string
): ExtensionAuthorMetadata => ({ [EXTENSION_AUTHOR_KEY]: extensionId })
