const { downloadFile, listFiles, listModels } = require('@huggingface/hub')
const { parse } = require('yaml')

/**
 * Get all branches related to a HF repository
 */
const getBranches = async (name) => {
  try {
    const response = await fetch(
      `https://huggingface.co/api/models/${name}/refs`
    )
    const data = await response.json()
    return data.branches.map((branch) => branch.name)
  } catch (err) {
    console.error('Failed to get HF branches:', err)
    return []
  }
}

/**
 * Try to find and read model.yml from main branch. This function is only used for HuggingFace.
 */
const tryGettingModelYaml = async (repoName, branch) => {
  // Onnx works only on Windows
  // Tensorrt-LLM works with Windows and Linux only
  // At build-time we could not detect user hardwares so can just check platform
  if (
    (branch.includes('onnx') && process.platform !== 'win32') ||
    (branch.includes('tensorrt') && process.platform === 'darwin') ||
    (branch.includes('tensorrt-llm-windows') && process.platform !== 'win32') ||
    (branch.includes('tensorrt-llm-linux') && process.platform !== 'linux')
  )
    return undefined

  const revision = branch ?? 'main'
  try {
    let files = []
    let model = {}
    let size = 0
    for await (const fileInfo of listFiles({
      repo: { type: 'model', name: repoName },
      revision,
    })) {
      // Git attributes - just ignore
      if (fileInfo.path === '.gitattributes' || fileInfo.path === 'README.md')
        continue

      // Model files - measure the size and continue
      if (fileInfo.path !== 'model.yml') {
        files.push(fileInfo.path)
        size += fileInfo.size
        continue
      }

      // Read model file
      const data = await (
        await downloadFile({
          repo: repoName,
          revision,
          path: fileInfo.path,
        })
      )?.text()

      if (!data) return undefined

      // Prepare the model file
      model = { ...model, ...parse(data) }
    }
    if (!model.model) throw 'No model.yml found'

    // Prepare the model sources
    model.sources = files.map((file) => ({
      filename: file,
      url: `https://huggingface.co/${repoName}/resolve/${branch}/${file}`,
    }))
    model.id = `${model.model.replace(':', '-')}-${branch}`

    // Download README.md for description parsing
    const data = await (
      await downloadFile({ repo: repoName, path: 'README.md' })
    )?.text()
    model.description = data
      .match(/## Overview\s+([\s\S]*?)## Variant/)[1]
      ?.trim()

    // At least try to pull size and branch name as tag
    model.metadata = {
      ...model.metadata,
      size,
      tags: [...(model.tags ?? []), branch],
      label: branch.replace('-windows', '').replace('-linux', ''),
    }
    return model
  } catch (e) {
    return undefined
  }
}

/**
 * Fetch all local model entries from cortexhub
 * using HF HUB API
 * @returns general model entries
 */
const fetchCortexHubModelEntries = async () => {
  const modelEntries = []

  // Filter by GGUF tags
  // this will fetch local models only
  // other model types are under different branches
  for await (const model of listModels({
    search: { owner: 'cortexso', tags: ['gguf'] },
  })) {
    modelEntries.push({
      ...model,
    })
  }

  return modelEntries
}

/**
 * Fetch all models from CortexHub
 */
const fetchCortexHubModels = async () => {
  const modelEntries = await fetchCortexHubModelEntries()
  let promises = []
  // Find all branches of a repo
  await Promise.all(
    modelEntries.map((model) =>
      getBranches(model.name).then((refs) => ({
        refs,
        model,
      }))
    )
  ).then((repos) => {
    // Find all valid branches that contain model.yml
    repos.forEach((repo) =>
      // If there is GGUF branch, don't try to pull from main
      (repo.refs.some((e) => e === 'gguf')
        ? repo.refs.filter((e) => e !== 'main')
        : repo.refs
      )
        .filter((e) => e !== 'default')
        .forEach((ref) => {
          promises.push(tryGettingModelYaml(repo.model.name, ref))
        })
    )
  })

  // Data gathered
  const modelData = await Promise.allSettled(promises)
  let results = []
  modelData.forEach((data) => {
    if (data.status === 'fulfilled') {
      const model = data.value
      if (model) {
        if (model.model_type === 'embedding') return
        results.push(model)
      }
    }
  })

  return results
}

/**
 * Module export
 */
module.exports = {
  fetchCortexHubModels,
}
