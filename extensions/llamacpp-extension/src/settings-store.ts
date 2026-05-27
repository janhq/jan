import { fs, joinPath, getJanDataFolderPath } from '@janhq/core'
import type { SettingComponentProps } from '@janhq/core'

const DIR_NAME = 'llamacpp'
const FILE_NAME = 'settings.json'
const TMP_NAME = 'settings.json.tmp'

let writeChain: Promise<unknown> = Promise.resolve()

async function paths(): Promise<{ dir: string; file: string; tmp: string }> {
  const root = await getJanDataFolderPath()
  const dir = await joinPath([root, DIR_NAME])
  const file = await joinPath([dir, FILE_NAME])
  const tmp = await joinPath([dir, TMP_NAME])
  return { dir, file, tmp }
}

export async function readSettingsFile(): Promise<SettingComponentProps[]> {
  const { file } = await paths()
  if (!(await fs.existsSync(file))) return []
  try {
    const raw = await fs.readFileSync(file, 'utf8')
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as SettingComponentProps[]) : []
  } catch {
    return []
  }
}

export async function writeSettingsFile(
  settings: SettingComponentProps[]
): Promise<void> {
  const task = async () => {
    const { dir, file, tmp } = await paths()
    if (!(await fs.existsSync(dir))) await fs.mkdir(dir)
    const json = JSON.stringify(settings, null, 2)
    await fs.writeFileSync(tmp, json)
    try {
      await fs.mv(tmp, file)
    } catch {
      await fs.writeFileSync(file, json)
      try {
        if (await fs.existsSync(tmp)) await fs.rm(tmp)
      } catch {
        /* best-effort */
      }
    }
  }
  writeChain = writeChain.then(task, task)
  await writeChain
}

export async function settingsFileExists(): Promise<boolean> {
  const { file } = await paths()
  return await fs.existsSync(file)
}
