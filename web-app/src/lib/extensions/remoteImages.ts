import { createContext, createElement, useContext, type ReactNode } from 'react'

/**
 * Whether the message being rendered may load remote images and favicons.
 * `MessageItem` turns it off for a message an extension authored (see
 * `authorship.ts`), and every widget under it that would fetch an image by
 * URL (citation favicons, the web tool's address bar) reads it. A context,
 * not a prop: those widgets sit several components deep in the tool trace.
 */
export const RemoteImagesContext = createContext(true)

export const useRemoteImagesAllowed = (): boolean =>
  useContext(RemoteImagesContext)

/**
 * `node` with remote images allowed or not below it. A function, so a
 * component's existing JSX tree does not have to be re-indented into a
 * provider.
 */
export const withRemoteImages = (
  allowed: boolean,
  node: ReactNode
): ReactNode =>
  createElement(RemoteImagesContext.Provider, { value: allowed }, node)
