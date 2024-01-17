import { MessageRequest } from "@janhq/core";

// import { OpenAIEmbeddings } from "langchain/embeddings/openai";
import { Retrieval } from "./tools/retrieval";

const retrieval = new Retrieval("", 1000);

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

export async function toolRetrievalIngestNewDocument(
  messageRequest: MessageRequest
) {
  const { messages } = messageRequest;
  console.log("toolRetrievalIngestNewDocument", messages);
  await retrieval.ingestDocument(
    "/Users/hiro/Downloads/791610_Optimizing_and_Running_LLaMA2_on_Intel_CPU_Whitepaper__Rev1.0.pdf"
  );
  return Promise.resolve(true);
}

export async function toolRetrievalLoadThreadMemory(
  messageRequest: MessageRequest
) {
  const { messages } = messageRequest;
  console.log("toolRetrievalLoadThreadMemory", messages);
  await retrieval.loadRetrievalAgent("/Users/hiro/jan/threads/testing_mem");
  return Promise.resolve(true);
}

export async function toolRetrievalQueryResult(messageRequest: MessageRequest) {
  const { messages } = messageRequest;
  if (!messages) return;
  console.log("toolRetrievalQueryResult", messages);
  const response = "I am a response from the retrieval tool with query: ";
  return Promise.resolve(response);
}
