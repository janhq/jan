/**
 * Default Analytic Service - Web implementation
 */

import { AppConfiguration } from '@janhq/core'
import type { AnalyticService } from './types'

export class DefaultAnalyticService implements AnalyticService {
  async updateDistinctId(id: string): Promise<void> {
    const appConfiguration: AppConfiguration =
      await window.core?.api?.getAppConfigurations()
    appConfiguration.distinct_id = id
    await window.core?.api?.updateAppConfiguration({
      configuration: appConfiguration,
    })
  }

  async getAppDistinctId(): Promise<string | undefined> {
    const appConfiguration: AppConfiguration =
      await window.core?.api?.getAppConfigurations()
    return appConfiguration.distinct_id
  }
}
