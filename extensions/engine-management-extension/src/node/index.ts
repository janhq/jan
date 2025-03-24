import * as path from 'path'
import {
  appResourcePath,
  getJanDataFolderPath,
  log,
} from '@janhq/core/node'
import { mkdir, readdir, symlink, cp } from 'fs/promises'
import { existsSync } from 'fs'

/**
 * Create symlink to each variant for the default bundled version
 * If running in AppImage environment, copy files instead of creating symlinks
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
  const isStandalone = process.platform === 'linux'
  
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

    // Skip if already exists
    if (existsSync(symlinkVariantPath)) {
      console.log(`Target already exists: ${symlinkVariantPath}`)
      continue
    }

    if (isStandalone) {
      // Copy files for AppImage environments instead of symlinking
      await cp(targetVariantPath, symlinkVariantPath, { recursive: true }).catch(
        (error) => log(JSON.stringify(error))
      )
      console.log(`Files copied: ${targetVariantPath} -> ${symlinkVariantPath}`)
    } else {
      // Create symlink for other environments
      await symlink(targetVariantPath, symlinkVariantPath, 'junction').catch(
        (error) => log(JSON.stringify(error))
      )
      console.log(`Symlink created: ${targetVariantPath} -> ${symlinkVariantPath}`)
    }
  }
}

export default {
  symlinkEngines,
}
