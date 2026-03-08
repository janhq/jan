/**
 * Analytic Service Types
 */

export interface AnalyticService {
  updateDistinctId(id: string): Promise<void>
  getAppDistinctId(): Promise<string | undefined>
}
