import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter'
import { formatDocumentsAsString } from 'langchain/util/document'
import { PDFLoader } from 'langchain/document_loaders/fs/pdf'

import { HNSWLib } from 'langchain/vectorstores/hnswlib'

import { OpenAIEmbeddings } from 'langchain/embeddings/openai'
import { readEmbeddingEngine } from '../../engine'

export class Retrieval {
  public chunkSize: number = 100
  public chunkOverlap?: number = 0
  private retriever: any

  private embeddingModel?: OpenAIEmbeddings = undefined
  private textSplitter?: RecursiveCharacterTextSplitter

  constructor(chunkSize: number = 4000, chunkOverlap: number = 200) {
    this.updateTextSplitter(chunkSize, chunkOverlap)
  }

  public updateTextSplitter(chunkSize: number, chunkOverlap: number): void {
    this.chunkSize = chunkSize
    this.chunkOverlap = chunkOverlap
    this.textSplitter = new RecursiveCharacterTextSplitter({
      chunkSize: chunkSize,
      chunkOverlap: chunkOverlap,
    })
  }

  public updateEmbeddingEngine(engine: string): void {
    // Engine settings are not compatible with the current embedding model params
    // Switch case manually for now
    const settings = readEmbeddingEngine(engine)
    if (engine === 'nitro') {
      this.embeddingModel = new OpenAIEmbeddings(
        { openAIApiKey: 'nitro-embedding' },
        // TODO: Raw settings
        { basePath: 'http://127.0.0.1:3928/v1' }
      )
    } else {
      // Fallback to OpenAI Settings
      this.embeddingModel = new OpenAIEmbeddings({
        openAIApiKey: settings.api_key,
      })
    }
  }

  public ingestAgentKnowledge = async (
    filePath: string,
    memoryPath: string
  ): Promise<any> => {
    const loader = new PDFLoader(filePath, {
      splitPages: true,
    })
    if (!this.embeddingModel) return Promise.reject()
    const doc = await loader.load()
    const docs = await this.textSplitter!.splitDocuments(doc)
    const vectorStore = await HNSWLib.fromDocuments(docs, this.embeddingModel)
    return vectorStore.save(memoryPath)
  }

  public loadRetrievalAgent = async (memoryPath: string): Promise<void> => {
    if (!this.embeddingModel) return Promise.reject()
    const vectorStore = await HNSWLib.load(memoryPath, this.embeddingModel)
    this.retriever = vectorStore.asRetriever(2)
    return Promise.resolve()
  }

  public generateResult = async (query: string): Promise<string> => {
    if (!this.retriever) {
      return Promise.resolve(' ')
    }
    const relevantDocs = await this.retriever.getRelevantDocuments(query)
    const serializedDoc = formatDocumentsAsString(relevantDocs)
    return Promise.resolve(serializedDoc)
  }
}

export const retrieval = new Retrieval()
