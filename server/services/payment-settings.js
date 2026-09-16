const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const db = require('../config/db');
const {paymentSettingsDir:directory}=require('../config/storage');
const keyPath = path.join(directory, 'payment-settings.key');
function key(create = false) {
  if (process.env.PAYMENT_CONFIG_KEY) {
    const result = Buffer.from(process.env.PAYMENT_CONFIG_KEY, 'base64');
    if (result.length !== 32) throw new Error('PAYMENT_CONFIG_KEY 必须是32字节密钥的Base64编码');
    return result;
  }
  if (!fs.existsSync(keyPath) && create) {
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(keyPath, crypto.randomBytes(32), { flag: 'wx', mode: 0o600 });
  }
  return fs.readFileSync(keyPath);
}
function readSettings() {
  const row = db.prepare('SELECT payload FROM payment_settings WHERE id = 1').get();
  if (!row) return {};
  return decrypt(row.payload);
}
function decrypt(payload) {
  const data = JSON.parse(payload);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(data.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(data.tag, 'base64'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(data.ciphertext, 'base64')), decipher.final()]).toString());
}
function encrypt(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(true), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  const payload = JSON.stringify({ iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') });
  return payload;
}
function saveSettings(settings, adminId) {
  const payload = encrypt(settings);
  db.prepare("INSERT INTO payment_settings (id, payload, updated_by, updated_at) VALUES (1, ?, ?, datetime('now','localtime')) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, updated_by=excluded.updated_by, updated_at=excluded.updated_at").run(payload, adminId);
}
module.exports = { readSettings, saveSettings, encrypt, decrypt };
