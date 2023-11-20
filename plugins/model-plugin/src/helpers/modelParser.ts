import { ModelCatalog } from '@janhq/core'

export function parseToModel(schema: ModelSchema): ModelCatalog {
  const modelVersions = []
  schema.versions.forEach((v) => {
    const version = {
      name: v.name,
      quantMethod: v.quantMethod,
      bits: v.bits,
      size: v.size,
      maxRamRequired: v.maxRamRequired,
      usecase: v.usecase,
      downloadLink: v.downloadLink,
    }
    modelVersions.push(version)
  })

  const model: ModelCatalog = {
    id: schema.id,
    name: schema.name,
    shortDescription: schema.shortDescription,
    avatarUrl: schema.avatarUrl,
    author: schema.author,
    version: schema.version,
    modelUrl: schema.modelUrl,
    tags: schema.tags,
    longDescription: schema.longDescription,
    releaseDate: 0,
    availableVersions: modelVersions,
  }
  return model
}
