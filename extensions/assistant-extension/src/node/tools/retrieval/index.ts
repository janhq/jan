import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { formatDocumentsAsString } from "langchain/util/document";
import { PDFLoader } from "langchain/document_loaders/fs/pdf";

// import { Chroma } from "@langchain/community/vectorstores/chroma";
import { HNSWLib } from "langchain/vectorstores/hnswlib";

import { HuggingFaceTransformersEmbeddings } from "@langchain/community/embeddings/hf_transformers";

const embeddingModel = new HuggingFaceTransformersEmbeddings({
  // modelName: "BAAI/bge-base-en-v1.5",
});

console.log(embeddingModel);

export class Retrieval {
  private readonly chunkSize: number;
  private readonly chunkOverlap?: number;
  private retriever: any;

  private embeddingModel: any = null;
  private textSplitter: any = null;
  private memoryPath: string;

  constructor(memoryPath: string, chunkSize: number) {
    this.chunkSize = chunkSize;
    this.textSplitter = new RecursiveCharacterTextSplitter({
      chunkSize: this.chunkSize,
      chunkOverlap: this.chunkOverlap,
    });
    this.embeddingModel = embeddingModel;
    this.memoryPath = memoryPath;
  }

  public ingestDocument = async (documentPath: string): Promise<any> => {
    // TODO: Persist instead of flushing every time
    if (this.retriever) {
      this.retriever = null;
    }

    // Start to ingest back to memory
    const loader = new PDFLoader(documentPath, {
      splitPages: false,
      parsedItemSeparator: "",
    });
    const doc = await loader.load();
    const docs = await this.textSplitter.splitDocuments(doc);
    const vectorStore = await HNSWLib.fromDocuments(docs, this.embeddingModel);
    await vectorStore.save(this.memoryPath);
  };

  public loadRetrievalAgent = async (memoryPath: string): Promise<any> => {
    const vectorStore = await HNSWLib.load(memoryPath, this.embeddingModel);
    this.retriever = vectorStore.asRetriever(2);
    await vectorStore.save(this.memoryPath);
    return Promise.resolve();
  };

  public generateResult = async (query: string): Promise<string> => {
    if (!this.retriever) {
      return Promise.resolve(`Relevant content: None.`);
    }
    const relevantDocs = await this.retriever.getRelevantDocuments(query);
    const serializedDoc = formatDocumentsAsString(relevantDocs);
    return Promise.resolve(`Relvant content: ${serializedDoc}.`);
  };
}
