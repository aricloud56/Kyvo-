// Production entry point: node dist/src/server/main.js
import { loadConfig } from './config.js';
import { createApp } from './app.js';

const cfg = loadConfig();
const app = await createApp(cfg);
app.server.listen(cfg.port, () => console.log(`KYVO listening on ${cfg.baseUrl} (port ${cfg.port})`));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => void app.close().then(() => process.exit(0)));
