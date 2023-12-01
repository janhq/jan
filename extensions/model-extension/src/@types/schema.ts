interface Version {
  name: string
  quantMethod: string
  bits: number
  size: number
  maxRamRequired: number
  usecase: string
  downloadLink: string
}
interface ModelSchema {
  id: string
  name: string
  shortDescription: string
  avatarUrl: string
  longDescription: string
  author: string
  version: string
  modelUrl: string
  tags: string[]
  versions: Version[]
}
