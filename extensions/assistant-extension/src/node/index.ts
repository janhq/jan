import { getJanDataFolderPath, normalizeFilePath } from "@janhq/core/node";
import { Retrieval } from "./tools/retrieval";
import path from "path";

const retrieval = new Retrieval();

export async function toolRetrievalUpdateTextSplitter(
  chunkSize: number,
  chunkOverlap: number,
) {
  retrieval.updateTextSplitter(chunkSize, chunkOverlap);
  return Promise.resolve();
}
export async function toolRetrievalIngestNewDocument(
  file: string,
  engine: string,
) {
  const filePath = path.join(getJanDataFolderPath(), normalizeFilePath(file));
  const threadPath = path.dirname(filePath.replace("files", ""));
  retrieval.updateEmbeddingEngine(engine);
  await retrieval.ingestAgentKnowledge(filePath, `${threadPath}/memory`);
  return Promise.resolve();
}

export async function toolRetrievalLoadThreadMemory(threadId: string) {
  try {
    await retrieval.loadRetrievalAgent(
      path.join(getJanDataFolderPath(), "threads", threadId, "memory"),
    );
    return Promise.resolve();
  } catch (err) {
    console.debug(err);
  }
}

export async function toolRetrievalQueryResult(query: string) {
  const res = await retrieval.generateResult(query);
  return Promise.resolve(res);
}
