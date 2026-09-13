import { createApp } from './app.ts';
import { loadConfig } from './config.ts';
import { createLogger } from './lib/logger.ts';
import { checkCopilotServices } from './modules/copilot/index.ts';
import { createServices } from './services.ts';

const log = createLogger('server');

const config = loadConfig();
const services = await createServices(config);
const app = createApp(services);

const server = app.listen(config.port, () => {
  const mode = (m: 'live' | 'sandbox') => (m === 'live' ? 'LIVE   ' : 'SANDBOX');
  const { integrations } = services.config;
  log.info(`current.surf API listening on http://localhost:${config.port} (${config.env})`);
  log.info(`  Google sign-in  ${mode(integrations.google)}`);
  log.info(`  Persona KYC/AML ${services.identityBypassed ? 'BYPASS ' : mode(integrations.persona)}`);
  log.info(`  Nessie banking  ${mode(integrations.nessie)}`);
  log.info(`  Dashboard data  ${services.cashflow.source === 'nessie' ? 'Nessie workspace' : 'generated sample ledger (CASHFLOW_SOURCE=mock)'}`);
  log.info(`  User state      ${services.persistence === 'postgres' ? 'PostgreSQL (keel schema: users, sessions, dashboard edits)' : 'in memory (reset on restart)'}`);
  log.info(`  Copilot ledger  ${config.copilot.ledgerUrl} (Java)`);
  log.info(`  Copilot AI      ${config.copilot.intelligenceUrl} (Python)${config.copilot.demoMode ? ' · DEMO_MODE' : ''}`);
  if (!config.isProduction) log.info(`  App URL         ${config.appUrl}`);
  for (const note of services.config.notes) log.warn(note);
  void checkCopilotServices(services.copilot, log);
});

const shutdown = (signal: string) => {
  log.info(`Received ${signal}, shutting down`);
  server.close(() => {
    void services.close().finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(0), 2000).unref();
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
