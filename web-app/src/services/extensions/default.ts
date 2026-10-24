/**
 * Default Extensions Service - no install pipeline outside the desktop app.
 * Reads return nothing installed; anything that would change state rejects.
 */

import type {
  CuratedIndex,
  ExtensionsService,
  IndexSource,
  InstalledExtension,
  ListResult,
  StagedInstall,
} from './types'

const unsupported = (): Promise<never> =>
  Promise.reject(
    new Error('Installing extensions is not supported on this platform')
  )

export class DefaultExtensionsService implements ExtensionsService {
  isSupported(): boolean {
    return false
  }

  async list(): Promise<ListResult> {
    return {
      safeMode: false,
      safeModeForced: false,
      recoveredFrom: null,
      extensions: [],
    }
  }

  async listSources(): Promise<IndexSource[]> {
    return []
  }

  stageBundle(): Promise<StagedInstall> {
    return unsupported()
  }

  stageFromIndex(): Promise<StagedInstall> {
    return unsupported()
  }

  confirmInstall(): Promise<InstalledExtension> {
    return unsupported()
  }

  // Nothing can have been staged here, so there is nothing to discard.
  async discardStage(): Promise<void> {}

  setEnabled(): Promise<void> {
    return unsupported()
  }

  setGrants(): Promise<void> {
    return unsupported()
  }

  uninstall(): Promise<void> {
    return unsupported()
  }

  rollback(): Promise<InstalledExtension> {
    return unsupported()
  }

  setSafeMode(): Promise<void> {
    return unsupported()
  }

  addSource(): Promise<IndexSource> {
    return unsupported()
  }

  removeSource(): Promise<void> {
    return unsupported()
  }

  getCatalog(): Promise<CuratedIndex> {
    return unsupported()
  }
}
