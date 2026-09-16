require('dotenv').config();
const db=require('../config/db');
const table=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='bank_cards'").get();
const count=table?db.prepare('SELECT COUNT(*) count FROM bank_cards').get().count:0;
console.log(JSON.stringify({legacyBankCardTable:!!table,legacyRowCount:count,action:count?'Restrict access; have the data owner review database and backups before approved deletion.':'No legacy bank-card rows detected.'},null,2));
db.close();
