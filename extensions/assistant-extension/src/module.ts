// const {
//   HuggingFaceTransformersEmbeddings,
// } = require("langchain/embeddings/hf_transformers");

const { OpenAIEmbeddings } = require("langchain/embeddings/openai");

process.env["OPENAI_API_KEY"] = "sk-";

// class Retrieval {
//   private readonly chunkSize: number;
//   private readonly chunkOverlap: number;
//   private retriever: any;

//   private embeddingModel = null;
//   private textSplitter = null;

//   constructor(chunkSize: number) {
//     this.chunkSize = chunkSize;
//     this.textSplitter = new RecursiveCharacterTextSplitter({
//       chunkSize: this.chunkSize,
//       chunkOverlap: this.chunkOverlap,
//     });
//     this.embeddingModel = new OpenAIEmbeddings();
//   }

//   public ingestDocument = async (
//     documentPath: string,
//     memoryPath: string
//   ): Promise<any> => {
//     const loader = new PDFLoader(documentPath, {
//       splitPages: false,
//       parsedItemSeparator: "",
//     });

//     const doc = await loader.load();
//     const docs = await this.textSplitter.splitDocuments(doc);
//     const vectorStore = await HNSWLib.fromDocuments(docs, this.embeddingModel);
//     await vectorStore.save(memoryPath);
//   };

//   public ingestConversationalHistory = async (
//     conversationHistoryArray
//   ): Promise<any> => {};

//   public loadRetrievalAgent = async (memoryPath: string): Promise<any> => {
//     const vectorStore = await HNSWLib.load(memoryPath, this.embeddingModel);
//     this.retriever = vectorStore.asRetriever(2);
//   };

//   public generateAnswer = async (query: string): Promise<string> => {
//     // Fetch relevant docs and serialize to a string.
//     const relevantDocs = await this.retriever.getRelevantDocuments(query);
//     const serializedDoc = formatDocumentsAsString(relevantDocs);
//     return serializedDoc;
//   };

//   public generateFollowUpQuestion = async (): Promise<any> => {
//     return;
//   };
// }

const retrieval = new Retrieval(1000, 1000);

// const run = async () => {

//   const retrieval = new Retrieval(embeddingModel, 1000);
//   await retrieval.ingestDocument(
//     "/Users/hiro/Downloads/791610_Optimizing_and_Running_LLaMA2_on_Intel_CPU_Whitepaper__Rev1.0.pdf",
//     "/Users/hiro/jan/threads/testing_mem"
//   );
//   await retrieval.loadRetrievalAgent("/Users/hiro/jan/threads/testing_mem");

//   const result = await retrieval.generateAnswer(
//     "What is the best way to run LLaMA2 on Intel CPU?"
//   );
//   console.log(result);
// };

// run();

async function toolRetrievalIngestNewDocument(messageRequest) {
  const uploadDocumentPath = "this";
  // await retrieval.ingestDocument(
  //   "/Users/hiro/Downloads/791610_Optimizing_and_Running_LLaMA2_on_Intel_CPU_Whitepaper__Rev1.0.pdf",
  //   "/Users/hiro/jan/threads/testing_mem"
  // );
  return true;
}

async function toolRetrievalLoadThreadMemory(messageRequest) {
  const memoryPath = "this";
  // await retrieval.loadRetrievalAgent("/Users/hiro/jan/threads/testing_mem");
  return true;
}

async function toolRetrievalQueryResult(messageRequest) {
  const { messages } = messageRequest;
  const latestMessage = messages[messages.length - 1];
  const response =
    "I am a response from the retrieval tool with query: " +
    latestMessage.content;
  return response;
}

module.exports = {
  toolRetrievalQueryResult,
  toolRetrievalIngestNewDocument,
  toolRetrievalLoadThreadMemory,
};
