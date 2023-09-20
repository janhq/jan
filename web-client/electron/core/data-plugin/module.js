const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const { app } = require("electron");

function init() {
  const db = new sqlite3.Database(path.join(app.getPath("userData"), "jan.db"));

  db.serialize(() => {
    db.run(
      "CREATE TABLE IF NOT EXISTS models ( id INTEGER PRIMARY KEY, name TEXT, image TEXT, url TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP);"
    );
    db.run(
      "CREATE TABLE IF NOT EXISTS conversations ( id INTEGER PRIMARY KEY, name TEXT, model_id INTEGER, image TEXT, message TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP);"
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
function getConversations() {
  return new Promise((res) => {
    const db = new sqlite3.Database(
      path.join(app.getPath("userData"), "jan.db")
    );

    db.all("SELECT * from conversations", (err, row) => {
      res(row);
    });
    db.close();
  });
}
function storeConversation(conversation) {
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
        conversation.message
      );
      stmt.finalize();
      res([]);
    });

    db.close();
  });
}
function storeMessage(message) {
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
        message.message
      );
      stmt.finalize();
      res([]);
    });

    db.close();
  });
}
function deleteConversation(id) {
  return new Promise((res) => {
    const db = new sqlite3.Database(
      path.join(app.getPath("userData"), "jan.db")
    );

    db.serialize(() => {
      const stmt = db.prepare("DELETE FROM conversations WHERE id = ?");
      stmt.run(id);
      stmt.finalize();
      res([]);
    });

    db.close();
  });
}

function getConversationMessages(conversation_id) {
  return new Promise((res) => {
    const db = new sqlite3.Database(
      path.join(app.getPath("userData"), "jan.db")
    );

    const query = `SELECT * FROM messages WHERE conversation_id = ${conversation_id}`;
    db.all(query, (err, row) => {
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
  getConversationMessages,
};
