import * as path from 'path'
import {
  appResourcePath,
  getJanDataFolderPath,
  log,
} from '@janhq/core/node'
import { mkdir, readdir, symlink } from 'fs/promises'


/**
 * Create symlink to each variant for the default bundled version
 */
const symlinkEngines = async () => {
  const sourceEnginePath = path.join(
    appResourcePath(),
    'shared',
    'engines',
    'cortex.llamacpp'
  )
  const symlinkEnginePath = path.join(
    getJanDataFolderPath(),
    'engines',
    'cortex.llamacpp'
  )
  const variantFolders = await readdir(sourceEnginePath)
  for (const variant of variantFolders) {
    const targetVariantPath = path.join(
      sourceEnginePath,
      variant,
      CORTEX_ENGINE_VERSION
    )
    const symlinkVariantPath = path.join(
      symlinkEnginePath,
      variant,
      CORTEX_ENGINE_VERSION
    )

    await mkdir(path.join(symlinkEnginePath, variant), {
      recursive: true,
    }).catch((error) => log(JSON.stringify(error)))

    await symlink(targetVariantPath, symlinkVariantPath, 'junction').catch(
      (error) => log(JSON.stringify(error))
    )
    console.log(`Symlink created: ${targetVariantPath} -> ${symlinkEnginePath}`)
  }
}

export default {
  symlinkEngines,
}
