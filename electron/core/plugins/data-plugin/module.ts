const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const { app } = require("electron");

const MODEL_TABLE_CREATION = `
CREATE TABLE IF NOT EXISTS models (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  short_description TEXT NOT NULL,
  avatar_url TEXT,
  long_description TEXT NOT NULL,
  author TEXT NOT NULL,
  version TEXT NOT NULL,
  model_url TEXT NOT NULL,
  nsfw INTEGER NOT NULL,
  tags TEXT NOT NULL,
  default_greeting TEXT NOT NULL,
  type TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);`;

const MODEL_VERSION_TABLE_CREATION = `
CREATE TABLE IF NOT EXISTS model_versions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  quant_method TEXT NOT NULL,
  bits INTEGER NOT NULL,
  size INTEGER NOT NULL,
  max_ram_required INTEGER NOT NULL,
  usecase TEXT NOT NULL,
  download_link TEXT NOT NULL,
  model_id TEXT NOT NULL,
  start_download_at INTEGER DEFAULT -1,
  finish_download_at INTEGER DEFAULT -1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);`;

const MODEL_TABLE_INSERTION = `
INSERT OR IGNORE INTO models (
  id,
  name,
  short_description,
  avatar_url,
  long_description,
  author,
  version,
  model_url,
  nsfw,
  tags,
  default_greeting,
  type
) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`;

const MODEL_VERSION_TABLE_INSERTION = `
INSERT INTO model_versions (
  id,
  name,
  quant_method,
  bits,
  size,
  max_ram_required,
  usecase,
  download_link,
  model_id,
  start_download_at
) VALUES (?,?,?,?,?,?,?,?,?,?)`;

const getDbPath = () => {
  return path.join(app.getPath("userData"), "jan.db");
};

function init() {
  const db = new sqlite3.Database(getDbPath());
  console.debug(`Database located at ${getDbPath()}`);

  db.serialize(() => {
    db.run(MODEL_TABLE_CREATION);
    db.run(MODEL_VERSION_TABLE_CREATION);
    db.run(
      "CREATE TABLE IF NOT EXISTS conversations ( id INTEGER PRIMARY KEY, name TEXT, model_id TEXT, image TEXT, message TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP);"
    );
    db.run(
      "CREATE TABLE IF NOT EXISTS messages ( id INTEGER PRIMARY KEY, name TEXT, conversation_id INTEGER, user TEXT, message TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP);"
    );
  });

  db.close();
}

/**
 * Store a model in the database when user start downloading it
 *
 * @param params: { model, modelVersion }
 */
function storeModel(params: any) {
  return new Promise((res) => {
    const db = new sqlite3.Database(getDbPath());
    console.debug("Inserting", JSON.stringify(params));

    const model = params.model;
    const modelTags = model.tags.join(",");
    const modelVersion = params.modelVersion;

    db.serialize(() => {
      const stmt = db.prepare(MODEL_TABLE_INSERTION);
      stmt.run(
        model.id,
        model.name,
        model.shortDescription,
        model.avatarUrl,
        model.longDescription,
        model.author,
        model.version,
        model.modelUrl,
        model.nsfw,
        modelTags,
        model.greeting,
        model.type
      );
      stmt.finalize();

      const stmt2 = db.prepare(MODEL_VERSION_TABLE_INSERTION);
      stmt2.run(
        modelVersion.id,
        modelVersion.name,
        modelVersion.quantMethod,
        modelVersion.bits,
        modelVersion.size,
        modelVersion.maxRamRequired,
        modelVersion.usecase,
        modelVersion.downloadLink,
        model.id,
        modelVersion.startDownloadAt
      );

      stmt2.finalize();
    });

    db.close();
    res(undefined);
  });
}

/**
 * Update the finished download time of a model
 *
 * @param model Product
 */
function updateFinishedDownloadAt(modelVersionId: string) {
  return new Promise((res, rej) => {
    const db = new sqlite3.Database(getDbPath());
    const time = Date.now();
    console.debug(
      `Updating finished downloaded model version ${modelVersionId}`
    );
    const stmt = `UPDATE model_versions SET finish_download_at = ? WHERE id = ?`;
    db.run(stmt, [time, modelVersionId], (err: any) => {
      if (err) {
        console.log(err);
        rej(err);
      } else {
        console.log("Updated 1 row");
        res("Updated");
      }
    });

    db.close();
  });
}

/**
 * Get all unfinished models from the database
 */
function getUnfinishedDownloadModels() {
  return new Promise((res) => {
    const db = new sqlite3.Database(getDbPath());

    const query = `SELECT * FROM model_versions WHERE finish_download_at = -1 ORDER BY start_download_at DESC`;
    db.all(query, (err: Error, row: any) => {
      if (row) {
        res(row);
      } else {
        res([]);
      }
    });
    db.close();
  });
}

async function getFinishedDownloadModels() {
  const db = new sqlite3.Database(getDbPath());
  try {
    const query = `SELECT * FROM model_versions WHERE finish_download_at != -1 ORDER BY finish_download_at DESC`;
    const modelVersions: any = await new Promise((resolve, reject) => {
      db.all(query, (err: Error, rows: any[]) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });

    const models = await Promise.all(
      modelVersions.map(async (modelVersion) => {
        const modelQuery = `SELECT * FROM models WHERE id = ?`;
        return new Promise((resolve, reject) => {
          db.get(
            modelQuery,
            [modelVersion.model_id],
            (err: Error, row: any) => {
              if (err) {
                reject(err);
              } else {
                resolve(row);
              }
            }
          );
        });
      })
    );

    const downloadedModels = [];
    modelVersions.forEach((modelVersion: any) => {
      const model = models.find((m: any) => m.id === modelVersion.model_id);

      if (!model) {
        return;
      }

      const assistantModel = {
        id: modelVersion.id,
        name: modelVersion.name,
        quantMethod: modelVersion.quant_method,
        bits: modelVersion.bits,
        size: modelVersion.size,
        maxRamRequired: modelVersion.max_ram_required,
        usecase: modelVersion.usecase,
        downloadLink: modelVersion.download_link,
        startDownloadAt: modelVersion.start_download_at,
        finishDownloadAt: modelVersion.finish_download_at,
        productId: model.id,
        productName: model.name,
        shortDescription: model.short_description,
        longDescription: model.long_description,
        avatarUrl: model.avatar_url,
        author: model.author,
        version: model.version,
        modelUrl: model.model_url,
        nsfw: model.nsfw === 0 ? false : true,
        greeting: model.default_greeting,
        type: model.type,
        createdAt: new Date(model.created_at).getTime(),
        updatedAt: new Date(model.updated_at ?? "").getTime(),
        status: "",
        releaseDate: -1,
        tags: model.tags.split(","),
      };
      downloadedModels.push(assistantModel);
    });

    db.close();

    return downloadedModels;
  } catch (err) {
    console.error(err);
    return [];
  }
}

function deleteDownloadModel(modelId: string) {
  return new Promise((res) => {
    const db = new sqlite3.Database(getDbPath());
    console.debug(`Deleting ${modelId}`);
    db.serialize(() => {
      const stmt = db.prepare("DELETE FROM model_versions WHERE id = ?");
      stmt.run(modelId);
      stmt.finalize();
      res(modelId);
    });

    db.close();
  });
}

function fetchModelVersion(db: any, versionId: string) {
  return new Promise((resolve, reject) => {
    db.get(
      "SELECT * FROM model_versions WHERE id = ?",
      [versionId],
      (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
        }
      }
    );
  });
}

async function fetchModel(db: any, modelId: string) {
  return new Promise((resolve, reject) => {
    db.get("SELECT * FROM models WHERE id = ?", [modelId], (err, row) => {
      if (err) {
        reject(err);
      } else {
        resolve(row);
      }
    });
  });
}

const getModelById = async (versionId: string): Promise<any | undefined> => {
  const db = new sqlite3.Database(getDbPath());
  const modelVersion: any | undefined = await fetchModelVersion(db, versionId);
  if (!modelVersion) return undefined;
  const model: any | undefined = await fetchModel(db, modelVersion.model_id);
  if (!model) return undefined;

  const assistantModel = {
    id: modelVersion.id,
    name: modelVersion.name,
    quantMethod: modelVersion.quant_method,
    bits: modelVersion.bits,
    size: modelVersion.size,
    maxRamRequired: modelVersion.max_ram_required,
    usecase: modelVersion.usecase,
    downloadLink: modelVersion.download_link,
    startDownloadAt: modelVersion.start_download_at,
    finishDownloadAt: modelVersion.finish_download_at,
    productId: model.id,
    productName: model.name,
    shortDescription: model.short_description,
    longDescription: model.long_description,
    avatarUrl: model.avatar_url,
    author: model.author,
    version: model.version,
    modelUrl: model.model_url,
    nsfw: model.nsfw === 0 ? false : true,
    greeting: model.default_greeting,
    type: model.type,
    createdAt: new Date(model.created_at).getTime(),
    updatedAt: new Date(model.updated_at ?? "").getTime(),
    status: "",
    releaseDate: -1,
    tags: model.tags.split(","),
  };

  return assistantModel;
};

function getConversations() {
  return new Promise((res) => {
    const db = new sqlite3.Database(getDbPath());

    db.all(
      "SELECT * FROM conversations ORDER BY updated_at DESC",
      (err: any, row: any) => {
        res(row);
      }
    );
    db.close();
  });
}

function storeConversation(conversation: any): Promise<number | undefined> {
  return new Promise((res) => {
    const db = new sqlite3.Database(getDbPath());

    db.serialize(() => {
      const stmt = db.prepare(
        "INSERT INTO conversations (name, model_id, image, message) VALUES (?, ?, ?, ?)"
      );
      stmt.run(
        conversation.name,
        conversation.model_id,
        conversation.image,
        conversation.message,
        function (err: any) {
          if (err) {
            // Handle the insertion error here
            console.error(err.message);
            res(undefined);
            return;
          }
          // @ts-ignoreF
          const id = this.lastID;
          res(id);
          return;
        }
      );
      stmt.finalize();
    });

    db.close();
  });
}

function storeMessage(message: any): Promise<number | undefined> {
  return new Promise((res) => {
    const db = new sqlite3.Database(getDbPath());

    db.serialize(() => {
      const stmt = db.prepare(
        "INSERT INTO messages (name, conversation_id, user, message) VALUES (?, ?, ?, ?)"
      );
      stmt.run(
        message.name,
        message.conversation_id,
        message.user,
        message.message,
        function (err: any) {
          if (err) {
            // Handle the insertion error here
            console.error(err.message);
            res(undefined);
            return;
          }
          //@ts-ignore
          const id = this.lastID;
          res(id);
          return;
        }
      );
      stmt.finalize();
    });

    db.close();
  });
}

function updateMessage(message: any): Promise<number | undefined> {
  return new Promise((res) => {
    const db = new sqlite3.Database(getDbPath());

    db.serialize(() => {
      const stmt = db.prepare(
        "UPDATE messages SET message = ?, updated_at = ? WHERE id = ?"
      );
      stmt.run(message.message, message.updated_at, message.id);
      stmt.finalize();
      res(message.id);
    });

    db.close();
  });
}

function deleteConversation(id: any) {
  return new Promise((res) => {
    const db = new sqlite3.Database(getDbPath());

    db.serialize(() => {
      const deleteConv = db.prepare("DELETE FROM conversations WHERE id = ?");
      deleteConv.run(id);
      deleteConv.finalize();
      const deleteMessages = db.prepare(
        "DELETE FROM messages WHERE conversation_id = ?"
      );
      deleteMessages.run(id);
      deleteMessages.finalize();
      res(id);
    });

    db.close();
  });
}

function getConversationMessages(conversation_id: any) {
  return new Promise((res) => {
    const db = new sqlite3.Database(getDbPath());

    const query = `SELECT * FROM messages WHERE conversation_id = ${conversation_id} ORDER BY id DESC`;
    db.all(query, (err: Error, row: any) => {
      res(row);
    });
    db.close();
  });
}

module.exports = {
  init,
  getConversations,
  deleteConversation,
  storeConversation,
  storeMessage,
  updateMessage,
  getConversationMessages,
  storeModel,
  updateFinishedDownloadAt,
  getUnfinishedDownloadModels,
  getFinishedDownloadModels,
  deleteDownloadModel,
  getModelById,
};
