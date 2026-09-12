import type { AppConfig } from '../../config.ts';
import { CopilotIdentityBridge } from './identityBridge.ts';
import { IntelligenceClient } from './intelligenceClient.ts';
import { LedgerClient } from './ledgerClient.ts';

/**
 * The Cash Flow Copilot backend seen from Express: a typed client per
 * service plus the bridge that keeps identity in step. Wired in
 * `server/services.ts`; routed in `./routes.ts`.
 */
export interface CopilotServices {
  ledger: LedgerClient;
  intelligence: IntelligenceClient;
  identity: CopilotIdentityBridge;
}

export function createCopilotServices(config: AppConfig): CopilotServices {
  const ledger = new LedgerClient(config.copilot);
  const intelligence = new IntelligenceClient(config.copilot);
  const identity = new CopilotIdentityBridge(ledger, config);
  return { ledger, intelligence, identity };
}

export { createCopilotRouter } from './routes.ts';
