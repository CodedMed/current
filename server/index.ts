import { createApp } from './app.ts';
import { loadConfig } from './config.ts';
import { createLogger } from './lib/logger.ts';
import { createServices } from './services.ts';

const log = createLogger('server');

const config = loadConfig();
const services = createServices(config);
const app = createApp(services);

const server = app.listen(config.port, () => {
  const mode = (m: 'live' | 'sandbox') => (m === 'live' ? 'LIVE   ' : 'SANDBOX');
  log.info(`Keel API listening on http://localhost:${config.port} (${config.env})`);
  log.info(`  Google sign-in  ${mode(config.integrations.google)}`);
  log.info(`  Persona KYC/AML ${mode(config.integrations.persona)}`);
  log.info(`  Nessie banking  ${mode(config.integrations.nessie)}`);
  if (!config.isProduction) log.info(`  App URL         ${config.appUrl}`);
  for (const note of config.notes) log.warn(note);
});

const shutdown = (signal: string) => {
  log.info(`Received ${signal}, shutting down`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
