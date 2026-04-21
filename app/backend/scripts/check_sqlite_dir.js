
import fs from 'fs';
import path from 'path';
import os from 'os';

const appData = process.env.APPDATA || (process.platform === 'darwin' ? path.join(os.homedir(), 'Library/Application Support') : path.join(os.homedir(), '.local/share'));
const configDir = path.join(appData, 'RongJiaHeERP', 'config');
const dataDir = path.join(appData, 'RongJiaHeERP', 'data');
const dbPath = path.join(dataDir, 'local_database.sqlite');

console.log('AppData:', appData);
console.log('Config Dir:', configDir);
console.log('Data Dir:', dataDir);
console.log('DB Path:', dbPath);

try {
  if (!fs.existsSync(configDir)) {
    console.log('Creating config dir...');
    fs.mkdirSync(configDir, { recursive: true });
    console.log('Config dir created.');
  } else {
    console.log('Config dir exists.');
  }

  if (!fs.existsSync(dataDir)) {
    console.log('Creating data dir...');
    fs.mkdirSync(dataDir, { recursive: true });
    console.log('Data dir created.');
  } else {
    console.log('Data dir exists.');
  }

  // Try to write a test file
  const testFile = path.join(dataDir, 'test_write.txt');
  fs.writeFileSync(testFile, 'test');
  console.log('Write test successful.');
  fs.unlinkSync(testFile);
  console.log('Delete test successful.');

} catch (e) {
  console.error('Error:', e);
}
