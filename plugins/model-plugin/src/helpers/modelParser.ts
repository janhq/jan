export const parseToModel = (model) => {
  const modelVersions = []
  model.versions.forEach((v) => {
    const version = {
      id: `${model.author}-${v.name}`,
      name: v.name,
      quantMethod: v.quantMethod,
      bits: v.bits,
      size: v.size,
      maxRamRequired: v.maxRamRequired,
      usecase: v.usecase,
      downloadLink: v.downloadLink,
      productId: model.id,
    }
    modelVersions.push(version)
  })

  const product = {
    id: model.id,
    name: model.name,
    shortDescription: model.shortDescription,
    avatarUrl: model.avatarUrl,
    author: model.author,
    version: model.version,
    modelUrl: model.modelUrl,
    nsfw: model.nsfw,
    tags: model.tags,
    greeting: model.defaultGreeting,
    type: model.type,
    createdAt: model.createdAt,
    longDescription: model.longDescription,
    status: 'Downloadable',
    releaseDate: 0,
    availableVersions: modelVersions,
  }
  return product
}
