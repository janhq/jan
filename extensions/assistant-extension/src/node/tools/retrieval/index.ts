import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { formatDocumentsAsString } from "langchain/util/document";
import { PDFLoader } from "langchain/document_loaders/fs/pdf";

// import { Chroma } from "@langchain/community/vectorstores/chroma";
import { HNSWLib } from "langchain/vectorstores/hnswlib";

import { HuggingFaceTransformersEmbeddings } from "@langchain/community/embeddings/hf_transformers";
const embeddingModel = new HuggingFaceTransformersEmbeddings({
  modelName: "BAAI/bge-base-en-v1.5",
});

// import { OpenAIEmbeddings } from "langchain/embeddings/openai";
// const embeddingModel = new OpenAIEmbeddings({});

// console.log(embeddingModel);

export class Retrieval {
  private readonly chunkSize: number = 100;
  private readonly chunkOverlap?: number = 0;
  private retriever: any;

  private embeddingModel: any = null;
  private textSplitter: any = null;

  constructor() {
    this.textSplitter = new RecursiveCharacterTextSplitter({
      chunkSize: this.chunkSize,
      chunkOverlap: this.chunkOverlap,
    });
    this.embeddingModel = embeddingModel;
  }

  public ingestAgentKnowledge = async (
    filePath: string,
    memoryPath: string
  ): Promise<any> => {
    const loader = new PDFLoader(filePath, {
      splitPages: false,
      parsedItemSeparator: "",
    });
    const doc = await loader.load();
    const docs = await this.textSplitter.splitDocuments(doc);
    const vectorStore = await HNSWLib.fromDocuments(docs, this.embeddingModel);
    await vectorStore.save(memoryPath);
  };

  public loadRetrievalAgent = async (memoryPath: string): Promise<any> => {
    const vectorStore = await HNSWLib.load(memoryPath, this.embeddingModel);
    this.retriever = vectorStore.asRetriever(2);
    await vectorStore.save(memoryPath);
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
