import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter'
import { formatDocumentsAsString } from 'langchain/util/document'
import { PDFLoader } from 'langchain/document_loaders/fs/pdf'

import { TimeWeightedVectorStoreRetriever } from 'langchain/retrievers/time_weighted'
import { MemoryVectorStore } from 'langchain/vectorstores/memory'

import { HNSWLib } from 'langchain/vectorstores/hnswlib'

import { OpenAIEmbeddings } from 'langchain/embeddings/openai'
import { readEmbeddingEngine } from './engine'

export class Retrieval {
  public chunkSize: number = 100
  public chunkOverlap?: number = 0
  private retriever: any

  private embeddingModel?: OpenAIEmbeddings = undefined
  private textSplitter?: RecursiveCharacterTextSplitter

  // to support time-weighted retrieval
  private timeWeightedVectorStore: MemoryVectorStore
  private timeWeightedretriever: any | TimeWeightedVectorStoreRetriever

  constructor(chunkSize: number = 4000, chunkOverlap: number = 200) {
    this.updateTextSplitter(chunkSize, chunkOverlap)

    // declare time-weighted retriever and storage
    this.timeWeightedVectorStore = new MemoryVectorStore(
      new OpenAIEmbeddings(
        { openAIApiKey: 'nitro-embedding' },
        { basePath: 'http://127.0.0.1:3928/v1' }
      )
    )
    this.timeWeightedretriever = new TimeWeightedVectorStoreRetriever({
      vectorStore: this.timeWeightedVectorStore,
      memoryStream: [],
      searchKwargs: 2,
    })
  }

  public updateTextSplitter(chunkSize: number, chunkOverlap: number): void {
    this.chunkSize = chunkSize
    this.chunkOverlap = chunkOverlap
    this.textSplitter = new RecursiveCharacterTextSplitter({
      chunkSize: chunkSize,
      chunkOverlap: chunkOverlap,
    })
  }

  public updateEmbeddingEngine(model: string, engine: string): void {
    // Engine settings are not compatible with the current embedding model params
    // Switch case manually for now
    if (engine === 'nitro') {
      this.embeddingModel = new OpenAIEmbeddings(
        { openAIApiKey: 'nitro-embedding', model },
        // TODO: Raw settings
        { basePath: 'http://127.0.0.1:3928/v1' },
      )
    } else {
      // Fallback to OpenAI Settings
      const settings = readEmbeddingEngine(engine)
      this.embeddingModel = new OpenAIEmbeddings({
        openAIApiKey: settings.api_key,
      })
    }

    // update time-weighted embedding model
    this.timeWeightedVectorStore.embeddings = this.embeddingModel
  }

  public ingestAgentKnowledge = async (
    filePath: string,
    memoryPath: string,
    useTimeWeighted: boolean
  ): Promise<any> => {
    const loader = new PDFLoader(filePath, {
      splitPages: true,
    })
    if (!this.embeddingModel) return Promise.reject()
    const doc = await loader.load()
    const docs = await this.textSplitter!.splitDocuments(doc)
    const vectorStore = await HNSWLib.fromDocuments(docs, this.embeddingModel)

    // add documents with metadata by using the time-weighted retriever in order to support time-weighted retrieval
    if (useTimeWeighted && this.timeWeightedretriever) {
      await (
        this.timeWeightedretriever as TimeWeightedVectorStoreRetriever
      ).addDocuments(docs)
    }
    return vectorStore.save(memoryPath)
  }

  public loadRetrievalAgent = async (memoryPath: string): Promise<void> => {
    if (!this.embeddingModel) return Promise.reject()
    const vectorStore = await HNSWLib.load(memoryPath, this.embeddingModel)
    this.retriever = vectorStore.asRetriever(2)
    return Promise.resolve()
  }

  public generateResult = async (
    query: string,
    useTimeWeighted: boolean
  ): Promise<string> => {
    if (useTimeWeighted) {
      if (!this.timeWeightedretriever) {
        return Promise.resolve(' ')
      }
      // use invoke because getRelevantDocuments is deprecated
      const relevantDocs = await this.timeWeightedretriever.invoke(query)
      const serializedDoc = formatDocumentsAsString(relevantDocs)
      return Promise.resolve(serializedDoc)
    }

    if (!this.retriever) {
      return Promise.resolve(' ')
    }

    // should use invoke(query) because getRelevantDocuments is deprecated
    const relevantDocs = await this.retriever.getRelevantDocuments(query)
    const serializedDoc = formatDocumentsAsString(relevantDocs)
    return Promise.resolve(serializedDoc)
  }
}

export const retrieval = new Retrieval()
