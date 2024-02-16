import { getJanDataFolderPath, normalizeFilePath } from '@janhq/core/node'
import { retrieval } from './tools/retrieval'
import path from 'path'

export function toolRetrievalUpdateTextSplitter(
  chunkSize: number,
  chunkOverlap: number
) {
  retrieval.updateTextSplitter(chunkSize, chunkOverlap)
}
export async function toolRetrievalIngestNewDocument(
  file: string,
  engine: string
) {
  const filePath = path.join(getJanDataFolderPath(), normalizeFilePath(file))
  const threadPath = path.dirname(filePath.replace('files', ''))
  retrieval.updateEmbeddingEngine(engine)
  return retrieval
    .ingestAgentKnowledge(filePath, `${threadPath}/memory`)
    .catch((err) => {
      console.error(err)
    })
}

export async function toolRetrievalLoadThreadMemory(threadId: string) {
  return retrieval
    .loadRetrievalAgent(
      path.join(getJanDataFolderPath(), 'threads', threadId, 'memory')
    )
    .catch((err) => {
      console.error(err)
    })
}

export async function toolRetrievalQueryResult(query: string) {
  return retrieval.generateResult(query).catch((err) => {
    console.error(err)
  })
}
