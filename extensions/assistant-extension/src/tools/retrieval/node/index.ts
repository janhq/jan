import { BufferMemory } from "langchain/memory";

import { PromptTemplate } from "langchain/prompts";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { formatDocumentsAsString } from "langchain/util/document";
import { HNSWLib } from "langchain/vectorstores/hnswlib";
import { PDFLoader } from "langchain/document_loaders/fs/pdf";

import { readFileSync } from "fs";

export class Retrieval {
  private readonly chunkSize: number;
  private readonly chunkOverlap: number;
  private shortTermMemory: BufferMemory;
  private retriever: any;

  private embeddingModel = null;
  private textSplitter = null;

  private queryRetrievalPrompt = PromptTemplate.fromTemplate(
    `Use the following pieces of context to answer the question at the end. If you don't know the answer, just say that you don't know, don't try to make up an answer.
  ----------------
  CHAT HISTORY: {chatHistory}
  ----------------
  CONTEXT: {context}
  ----------------
  QUESTION: {question}
  ----------------
  Helpful Answer:`
  );

  private questionGeneratorTemplate =
    PromptTemplate.fromTemplate(`Given the following conversation and a follow up question, rephrase the follow up question to be a standalone question.
----------------
CHAT HISTORY: {chatHistory}
----------------
FOLLOWUP QUESTION: {question}
----------------
Standalone question:`);

  constructor(embeddingModel: any, chunkSize: number) {
    this.chunkSize = chunkSize;
    this.textSplitter = new RecursiveCharacterTextSplitter({
      chunkSize: this.chunkSize,
      chunkOverlap: this.chunkOverlap,
    });
    this.embeddingModel = embeddingModel;

    this.shortTermMemory = new BufferMemory({
      memoryKey: "chatHistory",
    });
  }

  public ingestDocument = async (
    documentPath: string,
    memoryPath: string
  ): Promise<any> => {
    /* Load in the file we want to do question answering over */
    const loader = new PDFLoader(documentPath, {
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
  };

  public generateAnswer = async (query: string): Promise<string> => {
    // Fetch relevant docs and serialize to a string.
    const relevantDocs = await this.retriever.getRelevantDocuments(query);
    const serializedDoc = formatDocumentsAsString(relevantDocs);
    return serializedDoc;
  };

  public generateFollowUpQuestion = async (): Promise<any> => {
    return;
  };

  public ingestConversationalHistory = async (
    conversationHistoryArray
  ): Promise<any> => {};
}
