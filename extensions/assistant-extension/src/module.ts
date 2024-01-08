const { Retrieval } = require("./tools/retrieval/node/index.js");
const {
  HuggingFaceTransformersEmbeddings,
} = require("langchain/embeddings/hf_transformers");

// const run = async () => {
//   const embeddingModel = new HuggingFaceTransformersEmbeddings();

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

async function toolRetrieval(data) {
  console.log("toolRetrieval", data);
  const embeddingModel = new HuggingFaceTransformersEmbeddings();
  console.log(embeddingModel);
}

module.exports = {
  toolRetrieval,
};
