import {
  previewRegisterRoot,
  previewUnregisterRoot,
} from '@janhq/tauri-plugin-agent-tools-api'
import { getServiceHub } from '@/hooks/useServiceHub'
import { previewUrlFor } from '@/lib/coworkPreview'

/**
 * The unsandboxed preview: the page is loaded by URL from the `preview://`
 * scheme instead of inlined into a `srcDoc`, so it gets an origin of its own
 * (storage works, relative assets resolve) that is still not the app's. The
 * scheme serves only roots registered here; see `preview.rs`.
 */
export const registerPreviewRoot = (root: string, allowNetwork: boolean) =>
  previewRegisterRoot(root, allowNetwork)

export const unregisterPreviewRoot = (root: string) =>
  previewUnregisterRoot(root)

/** The `preview://` URL for an absolute file path, on this platform. */
export function previewUrl(abs: string): string {
  return previewUrlFor(abs, getServiceHub().core().convertFileSrc('/', 'preview'))
}
