import type { AppConfig } from '../../config.ts';
import type { Logger } from '../../lib/logger.ts';
import { CopilotIdentityBridge, type WorkspaceSnapshotSource } from './identityBridge.ts';
import { IntelligenceClient } from './intelligenceClient.ts';
import { LedgerClient } from './ledgerClient.ts';
import { EXPECTED_SERVICE_NAMES } from './upstream.ts';

/**
 * The Cash Flow Copilot backend seen from Express: a typed client per
 * service plus the bridge that keeps identity and bank data in step. Wired in
 * `server/services.ts`; routed in `./routes.ts`.
 */
export interface CopilotServices {
  ledger: LedgerClient;
  intelligence: IntelligenceClient;
  identity: CopilotIdentityBridge;
}

export interface CopilotServiceOptions {
  /** Reads the bank snapshot behind a user's workspace; null when the dashboard runs on the generated ledger. */
  snapshot?: WorkspaceSnapshotSource | null;
}

export function createCopilotServices(config: AppConfig, options: CopilotServiceOptions = {}): CopilotServices {
  const ledger = new LedgerClient(config.copilot);
  const intelligence = new IntelligenceClient(config.copilot);
  const identity = new CopilotIdentityBridge(ledger, config, { snapshot: options.snapshot ?? null });
  return { ledger, intelligence, identity };
}

/**
 * Startup probe. Catches the two configuration mistakes that otherwise surface as confusing
 * errors mid-demo: a service that is not running, and a *different* application answering on the
 * configured port (a port taken by another project).
 */
export async function checkCopilotServices({ ledger, intelligence }: CopilotServices, log: Logger): Promise<void> {
  const probe = async (name: 'ledger' | 'intelligence', url: string, health: () => Promise<{ service: string; demoMode: boolean }>) => {
    const label = name === 'ledger' ? 'Copilot ledger ' : 'Copilot AI     ';
    try {
      const result = await health();
      if (result.service !== EXPECTED_SERVICE_NAMES[name]) {
        log.warn(
          `${label} ${url} answered as "${result.service ?? 'unknown'}", not ${EXPECTED_SERVICE_NAMES[name]}. Another application holds that port; ` +
            `set ${name === 'ledger' ? 'LEDGER_SERVICE_URL' : 'INTELLIGENCE_SERVICE_URL (and INTELLIGENCE_SERVICE_PORT)'} to where the service really runs.`,
        );
        return;
      }
      log.info(`${label} ${url} ok (${result.service}${result.demoMode ? ', demo mode' : ''})`);
    } catch (err) {
      log.warn(`${label} ${url} not reachable (${err instanceof Error ? err.message : String(err)}). Copilot routes answer 503 until it is up: npm run dev:${name}.`);
    }
  };
  await Promise.all([
    probe('ledger', ledger.baseUrl, () => ledger.health()),
    probe('intelligence', intelligence.baseUrl, () => intelligence.health()),
  ]);
}

export { createCopilotRouter } from './routes.ts';
