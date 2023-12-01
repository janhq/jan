import { ModelCatalog } from '@janhq/core'

export const parseToModel = (modelGroup): ModelCatalog => {
  const modelVersions = []
  modelGroup.versions.forEach((v) => {
    const model = {
      object: 'model',
      version: modelGroup.version,
      source_url: v.downloadLink,
      id: v.name,
      name: v.name,
      owned_by: 'you',
      created: 0,
      description: modelGroup.longDescription,
      state: 'to_download',
      settings: v.settings,
      parameters: v.parameters,
      metadata: {
        engine: '',
        quantization: v.quantMethod,
        size: v.size,
        binaries: [],
        maxRamRequired: v.maxRamRequired,
        author: modelGroup.author,
        avatarUrl: modelGroup.avatarUrl,
      },
    }
    modelVersions.push(model)
  })

  const modelCatalog: ModelCatalog = {
    id: modelGroup.id,
    name: modelGroup.name,
    avatarUrl: modelGroup.avatarUrl,
    shortDescription: modelGroup.shortDescription,
    longDescription: modelGroup.longDescription,
    author: modelGroup.author,
    version: modelGroup.version,
    modelUrl: modelGroup.modelUrl,
    releaseDate: modelGroup.createdAt,
    tags: modelGroup.tags,
    availableVersions: modelVersions,
  }

  return modelCatalog
}
