
import sqlite3 from 'sqlite3';
import path from 'path';
import os from 'os';
import fs from 'fs';

const appData = process.env.APPDATA || (process.platform === 'darwin' ? path.join(os.homedir(), 'Library/Application Support') : path.join(os.homedir(), '.local/share'));
const dataDir = path.join(appData, 'RongJiaHeERP', 'data');
const dbPath = path.join(dataDir, 'local_database.sqlite').replace(/\\/g, '/');

console.log('Testing SQLite connection to:', dbPath);

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Could not connect to database', err);
  } else {
    console.log('Connected to database');
    db.run('CREATE TABLE IF NOT EXISTS test (id INTEGER PRIMARY KEY)', (err) => {
      if (err) {
        console.error('Error creating table', err);
      } else {
        console.log('Table created');
        db.close((err) => {
          if (err) console.error('Error closing db', err);
          else console.log('Database closed');
        });
      }
    });
  }
});
