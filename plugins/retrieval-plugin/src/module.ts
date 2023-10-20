const path = require("path");
const { app } = require("electron");
const lancedb = require("vectordb");
const { DirectoryLoader } = require("langchain/document_loaders/fs/directory");
const { LanceDB } = require("langchain/vectorstores/lancedb");
const { OpenAIEmbeddings } = require("langchain/embeddings/openai");
const { PDFLoader } = require("langchain/document_loaders/fs/pdf");

var db: any | undefined = undefined;
const textKey = "text";
/**
 * Returns a Promise that resolves to a database object.
 * If the database object has not been initialized yet, the function initializes it
 * by connecting to a database using the `lancedb.connect` function.
 * @returns A Promise that resolves to a database object.
 */
async function getDb() {
  if (!db) {
    const dbPath = path.join(app.getPath("userData"), "databases");
    db = await lancedb.connect(path.join(dbPath, "vectordb"));
  }
  return db;
}

/**
 * Create a table on data store
 *
 * @param     table    name of the table to create
 * @param     schema   schema of the table to create, include fields and their types
 * @returns   Promise<void>
 *
 */
function createVectorTable(table: string, schema?: { [key: string]: any }): Promise<void> {
  return new Promise<void>(async (resolve) => {
    await getDb().then((db) => db.createTable(table, [schema]));
    resolve();
  });
}

/**
 * Import db from documents
 *
 * @param     table              name of the table
 * @param     value              document to insert { document, embeddedDocs }
 * @returns   Promise<any>
 *
 */
function fromDocuments(table: string, value: any): Promise<any> {
  return new Promise<any>(async (resolve) => {
    getDb().then(async (db) => {
      const tbl = await db.openTable(table);
      const vectorStore = await addDocuments(value.docs, value.embeddedDocs, { tbl });
      resolve(vectorStore);
    });
  });
}

/**
 * Adds vectors and their corresponding documents to the database.
 * @param vectors The vectors to be added.
 * @param documents The corresponding documents to be added.
 * @returns A Promise that resolves when the vectors and documents have been added.
 */
async function addVectors(vectors: number[][], documents: any[], table: any) {
  if (vectors.length === 0) {
    return;
  }
  if (vectors.length !== documents.length) {
    throw new Error(`Vectors and documents must have the same length`);
  }

  const data: Array<Record<string, unknown>> = [];
  for (let i = 0; i < documents.length; i += 1) {
    const record = {
      vector: vectors[i],
      [this.textKey]: documents[i].pageContent,
    };
    Object.keys(documents[i].metadata).forEach((metaKey) => {
      record[metaKey] = documents[i].metadata[metaKey];
    });
    data.push(record);
  }
  await table.add(data);
}

/**
 * Adds documents to the database.
 * @param documents The documents to be added.
 * @returns A Promise that resolves when the documents have been added.
 */
function addDocuments(table: string, documents: any[], embeddings?: any): Promise<void> {
  return getDb().then(async (db) => {
    const tbl = await db.openTable(table);
    const texts = documents.map(({ pageContent }) => pageContent);
    addVectors(await embeddings.embedDocuments(texts), documents, tbl);
  });
}

/**
 * Performs a similarity search on the vectors in the database and returns
 * the documents and their scores.
 * @param query The query vector.
 * @param k The number of results to return.
 * @returns A Promise that resolves with an array of tuples, each containing a Document and its score.
 */
function similaritySearchVectorWithScore(table: string, query: number[], k: number): Promise<[any, number][]> {
  return getDb().then(async (db) => {
    const tbl = await db.openTable(table);
    const results = await tbl.search(query).limit(k).execute();

    const docsAndScore: [any, number][] = [];
    results.forEach((item) => {
      const metadata: Record<string, unknown> = {};
      Object.keys(item).forEach((key) => {
        if (key !== "vector" && key !== "score" && key !== textKey) {
          metadata[key] = item[key];
        }
      });

      docsAndScore.push([
        {
          pageContent: item[textKey] as string,
          metadata,
        },
        item.score as number,
      ]);
    });
    return docsAndScore;
  });
}

// For testing only
async function searchDocs(search: string, docDir: string, config: any): Promise<any> {
  return getDb().then(async (db) => {
    const table = await db.createTable("vectors", [{ vector: Array(1536), text: "Hello world", id: 1 }], {
      writeMode: lancedb.WriteMode.Overwrite,
    });
    const loader = new DirectoryLoader(docDir, {
      ".pdf": (path) => new PDFLoader(path),
    });
    const docs = await loader.load();
    const vectorStore = await LanceDB.fromDocuments(docs, new OpenAIEmbeddings(config), { table });
    const resultOne = await vectorStore.similaritySearch(search, 1);
    return resultOne;
  });
}

module.exports = {
  createVectorTable,
  fromDocuments,
  similaritySearchVectorWithScore,
  searchDocs,
};
