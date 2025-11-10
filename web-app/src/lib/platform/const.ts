import { PlatformFeature } from './types'

export const PlatformFeatures: Record<PlatformFeature, boolean> = {
  [PlatformFeature.LOCAL_API_SERVER]: true,
  [PlatformFeature.FILE_ATTACHMENTS]: true,
}
