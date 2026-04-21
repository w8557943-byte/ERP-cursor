
import app from './src/app.js';

console.log('Starting server via start.js wrapper');
// Wait for app to initialize if needed, or just let it run.
// Since app.js already calls startServer, we don't need to do anything here if isEntry is true.
// But we want to ensure process stays alive.
setInterval(() => {}, 1000);
