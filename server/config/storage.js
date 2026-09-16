const path = require('node:path');

const serverDir = path.join(__dirname, '..');
const resolvePath = value => path.isAbsolute(value) ? value : path.resolve(value);
const storageDir = process.env.STORAGE_DIR ? resolvePath(process.env.STORAGE_DIR) : null;
const dataDir = process.env.DATA_DIR
  ? resolvePath(process.env.DATA_DIR)
  : (storageDir || path.join(serverDir, 'data'));
const dbPath = process.env.DB_PATH === ':memory:'
  ? ':memory:'
  : resolvePath(process.env.DB_PATH || path.join(dataDir, 'ziyunhu.db'));
const uploadDir = resolvePath(process.env.UPLOAD_DIR
  || (storageDir ? path.join(storageDir, 'uploads') : path.join(serverDir, 'public', 'uploads')));
const backupDir = resolvePath(process.env.BACKUP_DIR || path.join(dataDir, 'backups'));
const paymentSettingsDir = resolvePath(process.env.PAYMENT_SETTINGS_DIR || dataDir);
const sessionSecretPath = path.join(dataDir, 'session-signing.key');

module.exports = {
  serverDir,
  storageDir,
  dataDir,
  dbPath,
  uploadDir,
  backupDir,
  paymentSettingsDir,
  sessionSecretPath,
};
