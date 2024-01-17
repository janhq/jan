import { MessageRequest, Thread } from "@janhq/core/.";
import { Retrieval } from "./tools/retrieval";
import os from "os";
import path from "path";

const userSpace = path.join(os.homedir(), "jan");
const retrieval = new Retrieval();

export async function toolRetrievalIngestNewDocument(data: any) {
  const { memoryPath, filesPath, message_id } = data;
  const reconstructedFilePath = path.join(
    userSpace,
    `${filesPath.slice(6, -1)}s`, // file:/threads/jan_1705485646/files -> threads/jan_1705485646/files
    `${message_id}.pdf`
  );
  await retrieval.ingestAgentKnowledge(reconstructedFilePath, memoryPath);
  return Promise.resolve();
}

export async function toolRetrievalLoadThreadMemory(thread: Thread) {
  console.log(
    "toolRetrievalLoadThreadMemory thread object",
    JSON.stringify(thread)
  );
  console.log("toolRetrievalLoadThreadMemory", thread.id);
  await retrieval.loadRetrievalAgent(path.join(thread.id, "memory"));
  return Promise.resolve();
}

export async function toolRetrievalQueryResult(messageRequest: MessageRequest) {
  const { messages } = messageRequest;
  if (!messages) return;
  console.log("toolRetrievalQueryResult", messages);
  const response = "I am a response from the retrieval tool with query: ";
  return Promise.resolve(response);
}
