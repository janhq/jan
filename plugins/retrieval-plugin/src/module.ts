const path = require("path");
const { app } = require("electron");
const { DirectoryLoader } = require("langchain/document_loaders/fs/directory");
const { OpenAIEmbeddings } = require("langchain/embeddings/openai");
const { PDFLoader } = require("langchain/document_loaders/fs/pdf");
const { CharacterTextSplitter } = require("langchain/text_splitter");
const { FaissStore } = require("langchain/vectorstores/faiss");
const { ChatOpenAI } = require("langchain/chat_models/openai");
const { RetrievalQAChain } = require("langchain/chains");

var db: any | undefined = undefined;

/**
 * Ingests documents from the specified directory using the `DirectoryLoader` class and splits them into questions and answers
 * using the `CharacterTextSplitter` class.
 * If an `embedding` object is provided, it uses it to generate embeddings for the documents using the `FaissStore` class.
 * Otherwise, it creates a new `OpenAIEmbeddings` object with the specified `config` and uses it to generate embeddings.
 * The resulting embeddings are stored in the database using the `FaissStore` class.
 * @param docDir - The directory containing the documents to ingest.
 * @param embedding - An optional object used to generate embeddings for the documents.
 * @param config - An optional configuration object used to create a new `OpenAIEmbeddings` object.
 */
async function ingest(docDir: string, embedding?: any, config?: any) {
  const loader = new DirectoryLoader(docDir, {
    ".pdf": (path) => new PDFLoader(path),
  });
  const docs = await loader.load();
  const textSplitter = new CharacterTextSplitter();
  const docsQA = await textSplitter.splitDocuments(docs);
  const embeddings = embedding ?? new OpenAIEmbeddings({ ...config });
  db = await FaissStore.fromDocuments(await docsQA, embeddings);
  console.log("Documents are ingested");
}

/**
 * Generates an answer to a given question using the specified `llm` object or a new `ChatOpenAI` object with the specified `config`.
 * The function uses the `RetrievalQAChain` class to retrieve the most relevant document from the database and generate an answer.
 * @param question - The question to generate an answer for.
 * @param llm - An optional object used to generate the answer.
 * @param config - An optional configuration object used to create a new `ChatOpenAI` object.
 * @returns A Promise that resolves with the generated answer.
 */
async function chatWithDocs(question: string, llm?: any, config?: any): Promise<any> {
  const llm_question_answer =
    llm ??
    new ChatOpenAI({
      temperature: 0.2,
      ...config,
    });
  const qa = RetrievalQAChain.fromLLM(llm_question_answer, db.asRetriever(), {
    verbose: true,
  });
  const answer = await qa.run(question);
  return answer;
}

module.exports = {
  ingest,
  chatWithDocs,
};
