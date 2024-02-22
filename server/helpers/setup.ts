import { join, extname } from 'path'
import { existsSync, readdirSync, writeFileSync, mkdirSync } from 'fs'
import { init, installExtensions } from '@janhq/core/node'

export async function setup() {
  /**
   * Setup Jan Data Directory
   */
  const appDir = process.env.JAN_DATA_DIRECTORY ?? join(__dirname, '..', 'jan')

  console.debug(`Create app data directory at ${appDir}...`)
  if (!existsSync(appDir)) mkdirSync(appDir)
  //@ts-ignore
  global.core = {
    // Define appPath function for app to retrieve app path globaly
    appPath: () => appDir,
  }
  init({
    extensionsPath: join(appDir, 'extensions'),
  })

  /**
   * Write app configurations. See #1619
   */
  console.debug('Writing config file...')
  writeFileSync(
    join(appDir, 'settings.json'),
    JSON.stringify({
      data_folder: appDir,
    }),
    'utf-8'
  )

  if (!existsSync(join(appDir, 'settings'))) {
    console.debug('Writing nvidia config file...')
    mkdirSync(join(appDir, 'settings'))
    writeFileSync(
      join(appDir, 'settings', 'settings.json'),
      JSON.stringify(
        {
          notify: true,
          run_mode: 'cpu',
          nvidia_driver: {
            exist: false,
            version: '',
          },
          cuda: {
            exist: false,
            version: '',
          },
          gpus: [],
          gpu_highest_vram: '',
          gpus_in_use: [],
          is_initial: true,
        }),
      'utf-8'
    )
  }

  /**
   * Install extensions
   */

  console.debug('Installing extensions...')

  const baseExtensionPath = join(__dirname, '../../..', 'pre-install')
  const extensions = readdirSync(baseExtensionPath)
    .filter((file) => extname(file) === '.tgz')
    .map((file) => join(baseExtensionPath, file))

  await installExtensions(extensions)
  console.debug('Extensions installed')
}
