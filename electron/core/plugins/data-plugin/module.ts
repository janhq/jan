const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const { app } = require("electron");

const MODEL_TABLE_CREATION = `
CREATE TABLE IF NOT EXISTS models (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  avatar_url TEXT,
  long_description TEXT NOT NULL,
  technical_description TEXT NOT NULL,
  author TEXT NOT NULL,
  version TEXT NOT NULL,
  model_url TEXT NOT NULL,
  nsfw INTEGER NOT NULL,
  greeting TEXT NOT NULL,
  type TEXT NOT NULL,
  file_name TEXT NOT NULL,
  download_url TEXT NOT NULL,
  start_download_at INTEGER DEFAULT -1,
  finish_download_at INTEGER DEFAULT -1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);`;

const MODEL_TABLE_INSERTION = `
INSERT INTO models (
  id,
  slug,
  name,
  description,
  avatar_url,
  long_description,
  technical_description,
  author,
  version,
  model_url,
  nsfw,
  greeting,
  type,
  file_name,
  download_url,
  start_download_at
) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;

function init() {
  const db = getDb()
  console.log(
    `Database located at ${path.join(app.getPath("userData"), "jan.db")}`
  );

  db.serialize(() => {
    db.run(MODEL_TABLE_CREATION);
    db.run(
      "CREATE TABLE IF NOT EXISTS conversations ( id INTEGER PRIMARY KEY, name TEXT, model_id TEXT, image TEXT, message TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP);"
    );
    db.run(
      "CREATE TABLE IF NOT EXISTS messages ( id INTEGER PRIMARY KEY, name TEXT, conversation_id INTEGER, user TEXT, message TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP);"
    );
  });

  const stmt = db.prepare(
    "INSERT INTO conversations (name, model_id, image, message) VALUES (?, ?, ?, ?)"
  );
  stmt.finalize();
  db.close();
}

/**
 * Store a model in the database when user start downloading it
 *
 * @param model Product
 */
function storeModel(model: any) {
  return new Promise((res) => {
    const db = getDb()
    console.debug("Inserting", JSON.stringify(model));
    db.serialize(() => {
      const stmt = db.prepare(MODEL_TABLE_INSERTION);
      stmt.run(
        model.id,
        model.slug,
        model.name,
        model.description,
        model.avatarUrl,
        model.longDescription,
        model.technicalDescription,
        model.author,
        model.version,
        model.modelUrl,
        model.nsfw,
        model.greeting,
        model.type,
        model.fileName,
        model.downloadUrl,
        Date.now(),
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

/**
 * Update the finished download time of a model
 *
 * @param model Product
 */
function updateFinishedDownloadAt(fileName: string, time: number) {
  return new Promise((res) => {
    const db = getDb()
    console.debug(`Updating fileName ${fileName} to ${time}`);
    const stmt = `UPDATE models SET finish_download_at = ? WHERE file_name = ?`;
    db.run(stmt, [time, fileName], (err: any) => {
      if (err) {
        console.log(err);
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
    const db = getDb()

    const query = `SELECT * FROM models WHERE finish_download_at = -1 ORDER BY start_download_at DESC`;
    db.all(query, (err: Error, row: any) => {
      res(row);
    });
    db.close();
  });
}

function getFinishedDownloadModels() {
  return new Promise((res) => {
    const db = getDb()

    const query = `SELECT * FROM models WHERE finish_download_at != -1 ORDER BY finish_download_at DESC`;
    db.all(query, (err: Error, row: any) => {
      res(row.map((item: any) => parseToProduct(item)));
    });
    db.close();
  });
}

function deleteDownloadModel(modelId: string) {
  return new Promise((res) => {
    const db = new sqlite3.Database(
      path.join(app.getPath("userData"), "jan.db")
    );
    console.log(`Deleting ${modelId}`);
    db.serialize(() => {
      const stmt = db.prepare("DELETE FROM models WHERE id = ?");
      stmt.run(modelId);
      stmt.finalize();
      res(modelId);
    });

    db.close();
  });
}

function getModelById(modelId: string) {
  return new Promise((res) => {
    const db = new sqlite3.Database(
      path.join(app.getPath("userData"), "jan.db")
    );

    console.debug("Get model by id", modelId);
    db.get(
      `SELECT * FROM models WHERE id = ?`,
      [modelId],
      (err: any, row: any) => {
        console.debug("Get model by id result", row);

        if (row) {
          const product = {
            id: row.id,
            slug: row.slug,
            name: row.name,
            description: row.description,
            avatarUrl: row.avatar_url,
            longDescription: row.long_description,
            technicalDescription: row.technical_description,
            author: row.author,
            version: row.version,
            modelUrl: row.model_url,
            nsfw: row.nsfw,
            greeting: row.greeting,
            type: row.type,
            inputs: row.inputs,
            outputs: row.outputs,
            createdAt: new Date(row.created_at),
            updatedAt: new Date(row.updated_at),
            fileName: row.file_name,
            downloadUrl: row.download_url,
          };
          res(product);
        }
      }
    );

    db.close();
  });
}

function getConversations() {
  return new Promise((res) => {
    const db = getDb()

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
    const db = new sqlite3.Database(
      path.join(app.getPath("userData"), "jan.db")
    );

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
    const db = new sqlite3.Database(
      path.join(app.getPath("userData"), "jan.db")
    );

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
    const db = new sqlite3.Database(
      path.join(app.getPath("userData"), "jan.db")
    );

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
    const db = new sqlite3.Database(
      path.join(app.getPath("userData"), "jan.db")
    );

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
    const db = getDb()

    const query = `SELECT * FROM messages WHERE conversation_id = ${conversation_id} ORDER BY id DESC`;
    db.all(query, (err: Error, row: any) => {
      res(row);
    });
    db.close();
  });
}

function parseToProduct(row: any) {
  const product = {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    avatarUrl: row.avatar_url,
    longDescription: row.long_description,
    technicalDescription: row.technical_description,
    author: row.author,
    version: row.version,
    modelUrl: row.model_url,
    nsfw: row.nsfw,
    greeting: row.greeting,
    type: row.type,
    inputs: row.inputs,
    outputs: row.outputs,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    fileName: row.file_name,
    downloadUrl: row.download_url,
  };
  return product;
}

function getDb(){
  if(app){
    return new sqlite3.Database(
      path.join(app.getPath("userData"), "jan.db")
    );
  }
  return new sqlite3.Database(
    path.join("/Users/john-jan/Library/Application Support/jan-electron", "jan.db")
  );
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
