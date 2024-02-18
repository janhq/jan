import fs from 'fs'
import path from 'path'
import { getJanDataFolderPath } from '@janhq/core/node'

// Sec: Do not send engine settings over requests
// Read it manually instead
export const readEmbeddingEngine = (engineName: string) => {
  const engineSettings = fs.readFileSync(
    path.join(getJanDataFolderPath(), 'engines', `${engineName}.json`),
    'utf-8'
  )
  return JSON.parse(engineSettings)
}
