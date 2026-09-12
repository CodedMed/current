import type { AppConfig } from './config.ts';
import { GoogleAuthProvider } from './modules/auth/googleProvider.ts';
import { SandboxAuthProvider } from './modules/auth/sandboxProvider.ts';
import type { AuthProvider } from './modules/auth/types.ts';
import { MockCashflowStore } from './modules/cashflow/mock/store.ts';
import { createCopilotServices, type CopilotServices } from './modules/copilot/index.ts';
import { NessieCashflowStore } from './modules/cashflow/nessie/nessieStore.ts';
import type { CashflowStore } from './modules/cashflow/store.ts';
import { BypassIdentityService } from './modules/identity/bypassIdentityService.ts';
import { PersonaIdentityService } from './modules/identity/personaService.ts';
import { SandboxIdentityService } from './modules/identity/sandboxIdentityService.ts';
import type { IdentityService } from './modules/identity/types.ts';
import { createNessieApi } from './modules/nessie/index.ts';
import { Provisioner } from './modules/nessie/provisioner.ts';
import type { NessieApi } from './modules/nessie/types.ts';
import { InMemoryUserRepository, type UserRepository } from './store/userStore.ts';

/**
 * Persona is live: with `PERSONA_API_KEY` and `PERSONA_TEMPLATE_ID` set the
 * verify step creates a real inquiry, otherwise the sandbox stand-in is used.
 * Flip this to `true` only to skip KYC while developing the dashboard.
 */
const IDENTITY_BYPASS = false;

/**
 * Composition root. Every integration is chosen here based on which
 * credentials exist, so the rest of the app depends only on interfaces.
 */
export interface Services {
  config: AppConfig;
  users: UserRepository;
  auth: AuthProvider;
  identity: IdentityService;
  identityBypassed: boolean;
  nessie: NessieApi;
  provisioner: Provisioner;
  cashflow: CashflowStore;
  /** Cash Flow Copilot backend: Java ledger + Python intelligence, behind Express. */
  copilot: CopilotServices;
}

export function createServices(config: AppConfig): Services {
  const users = new InMemoryUserRepository();
  const auth: AuthProvider = config.google ? new GoogleAuthProvider(config.google) : new SandboxAuthProvider(config.appUrl);

  let identity: IdentityService;
  let effectiveConfig = config;
  if (IDENTITY_BYPASS) {
    identity = new BypassIdentityService(users);
    effectiveConfig = {
      ...config,
      integrations: { ...config.integrations, persona: 'sandbox' },
      notes: [...config.notes, 'Persona API calls are bypassed (IDENTITY_BYPASS in server/services.ts); every verification auto-approves.'],
    };
  } else {
    identity = config.persona ? new PersonaIdentityService(config.persona, users) : new SandboxIdentityService(users);
  }

  const nessie = createNessieApi(config);
  const provisioner = new Provisioner(nessie, users);
  const cashflow: CashflowStore = config.cashflowSource === 'mock' ? new MockCashflowStore() : new NessieCashflowStore(nessie, users);
  const copilot = createCopilotServices(effectiveConfig);
  return { config: effectiveConfig, users, auth, identity, identityBypassed: IDENTITY_BYPASS, nessie, provisioner, cashflow, copilot };
}
