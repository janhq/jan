const sqlite3 = require("sqlite3").verbose();

module.exports = {
  testNodeProcess: function () {
    const db = new sqlite3.Database("./jan.db");

    db.serialize(() => {
      db.run("CREATE TABLE IF NOT EXISTS lorem (info TEXT)");

      const stmt = db.prepare("INSERT INTO lorem VALUES (?)");
      for (let i = 0; i < 10; i++) {
        stmt.run("Ipsum " + i);
      }
      stmt.finalize();

      db.each("SELECT rowid AS id, info FROM lorem", (err, row) => {
        console.log(row.id + ": " + row.info);
      });
    });

    db.close();
    console.log(`run base-plugin's module in node process`);
  },
};
