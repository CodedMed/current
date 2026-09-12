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
  const { integrations } = services.config;
  log.info(`Keel API listening on http://localhost:${config.port} (${config.env})`);
  log.info(`  Google sign-in  ${mode(integrations.google)}`);
  log.info(`  Persona KYC/AML ${services.identityBypassed ? 'BYPASS ' : mode(integrations.persona)}`);
  log.info(`  Nessie banking  ${mode(integrations.nessie)} (dashboard currently uses the mock cash-flow API)`);
  if (!config.isProduction) log.info(`  App URL         ${config.appUrl}`);
  for (const note of services.config.notes) log.warn(note);
});

const shutdown = (signal: string) => {
  log.info(`Received ${signal}, shutting down`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
