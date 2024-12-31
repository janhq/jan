import { getJanDataFolderPath } from '@janhq/core/node'
import { retrieval } from './retrieval'
import path from 'path'

export function toolRetrievalUpdateTextSplitter(
  chunkSize: number,
  chunkOverlap: number
) {
  retrieval.updateTextSplitter(chunkSize, chunkOverlap)
}
export async function toolRetrievalIngestNewDocument(
  thread: string,
  file: string,
  model: string,
  engine: string,
  useTimeWeighted: boolean
) {
  const threadPath = path.join(getJanDataFolderPath(), 'threads', thread)
  const filePath = path.join(getJanDataFolderPath(), 'files', file)
  retrieval.updateEmbeddingEngine(model, engine)
  return retrieval
    .ingestAgentKnowledge(filePath, `${threadPath}/memory`, useTimeWeighted)
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

export async function toolRetrievalQueryResult(
  query: string,
  useTimeWeighted: boolean = false
) {
  return retrieval.generateResult(query, useTimeWeighted).catch((err) => {
    console.error(err)
  })
}
