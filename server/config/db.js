const fs = require('fs');
const path = require('node:path');
const { dbPath, dataDir } = require('./storage');

// DB_PATH can point outside DATA_DIR, so create the directory that actually
// owns the database file rather than assuming both paths are identical.
if (dbPath !== ':memory:') {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
}

function createBuiltinDatabase(filename) {
  const sqlite = require('node:sqlite');
  const db = new sqlite.DatabaseSync(filename);
  let transactionDepth = 0;
  let savepointId = 0;

  db.pragma = (statement, options = {}) => {
    const rows = db.prepare(`PRAGMA ${statement}`).all();
    if (!options.simple) return rows;
    const first = rows[0];
    return first ? Object.values(first)[0] : undefined;
  };
  db.transaction = callback => {
    const makeRunner = mode => (...args) => {
      const nested = transactionDepth > 0;
      const savepoint = `codex_tx_${++savepointId}`;
      db.exec(nested ? `SAVEPOINT ${savepoint}` : `BEGIN${mode ? ` ${mode}` : ''}`);
      transactionDepth += 1;
      try {
        const result = callback(...args);
        transactionDepth -= 1;
        db.exec(nested ? `RELEASE SAVEPOINT ${savepoint}` : 'COMMIT');
        return result;
      } catch (error) {
        transactionDepth -= 1;
        if (nested) db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}; RELEASE SAVEPOINT ${savepoint}`);
        else db.exec('ROLLBACK');
        throw error;
      }
    };
    const transaction = makeRunner('');
    transaction.deferred = transaction;
    transaction.immediate = makeRunner('IMMEDIATE');
    transaction.exclusive = makeRunner('EXCLUSIVE');
    return transaction;
  };
  db.backup = target => sqlite.backup(db, target);
  return db;
}

let db;
try {
  db = createBuiltinDatabase(dbPath);
} catch (error) {
  if (error?.code !== 'ERR_UNKNOWN_BUILTIN_MODULE' && error?.code !== 'MODULE_NOT_FOUND') throw error;
  const Database = require('better-sqlite3');
  db = new Database(dbPath);
}

// 开启 WAL 模式提升并发性能
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

module.exports = db;
