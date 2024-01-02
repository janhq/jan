import { RetrievalQAChain, loadQAStuffChain } from "langchain/chains";
import { CheerioWebBaseLoader } from "langchain/document_loaders/web/cheerio";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { HNSWLib } from "langchain/vectorstores/hnswlib";
import { Ollama } from "langchain/llms/ollama";
import { PromptTemplate } from "langchain/prompts";
import { HuggingFaceTransformersEmbeddings } from "langchain/embeddings/hf_transformers";

export const run = async () => {
  const loader = new CheerioWebBaseLoader(
    "https://lilianweng.github.io/posts/2023-06-23-agent/"
  );
  const docs = await loader.load();

  const splitter = new RecursiveCharacterTextSplitter({
    chunkOverlap: 0,
    chunkSize: 500,
  });

  const splitDocuments = await splitter.splitDocuments(docs);

  const vectorstore = await HNSWLib.fromDocuments(
    splitDocuments,
    new HuggingFaceTransformersEmbeddings()
  );

  const retriever = vectorstore.asRetriever();

  // Llama 2 7b wrapped by Ollama
  const model = new Ollama({
    baseUrl: "http://localhost:11434",
    model: "llama2",
  });

  const template = `Use the following pieces of context to answer the question at the end.
  If you don't know the answer, just say that you don't know, don't try to make up an answer.
  Use three sentences maximum and keep the answer as concise as possible.
  Always say "thanks for asking!" at the end of the answer.
  {context}
  Question: {question}
  Helpful Answer:`;

  const QA_CHAIN_PROMPT = new PromptTemplate({
    inputVariables: ["context", "question"],
    template,
  });

  // Create a retrieval QA chain that uses a Llama 2-powered QA stuff chain with a custom prompt.
  const chain = new RetrievalQAChain({
    combineDocumentsChain: loadQAStuffChain(model, { prompt: QA_CHAIN_PROMPT }),
    retriever,
    returnSourceDocuments: true,
    inputKey: "question",
  });

  const response = await chain.call({
    question: "What are the approaches to Task Decomposition?",
  });

  console.log(response);
};

run();
