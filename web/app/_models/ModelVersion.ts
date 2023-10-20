/**
 * Model type which will be stored in the database
 */
export type ModelVersion = {
  /**
   * Combination of owner and model name.
   * Being used as file name. Should be unique.
   */
  _id: string
  name: string
  quantMethod: string
  bits: number
  size: number
  maxRamRequired: number
  usecase: string
  downloadLink: string
  productId: string
  /**
   * For tracking download state
   */
  startDownloadAt?: number
  finishDownloadAt?: number
}
