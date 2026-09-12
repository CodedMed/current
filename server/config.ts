import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { IntegrationStatus } from '../shared/types.ts';

/**
 * All configuration is read once from the environment. Secrets never leave this
 * module except through the typed config object consumed by server modules.
 */

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  APP_URL: z.url().default('http://localhost:5173'),
  SESSION_SECRET: z.string().min(16).optional(),

  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),

  PERSONA_API_KEY: z.string().optional(),
  PERSONA_TEMPLATE_ID: z.string().optional(),
  PERSONA_WEBHOOK_SECRET: z.string().optional(),
  PERSONA_API_VERSION: z.string().default('2025-12-08'),
  PERSONA_ACCEPT_COMPLETED: z.stringbool().optional(),
  PERSONA_BASE_URL: z.url().default('https://api.withpersona.com'),

  NESSIE_API_KEY: z.string().optional(),
  NESSIE_BASE_URL: z.url().default('https://api.nessieisreal.com'),

  /** Where the cash-flow dashboard reads from: the Nessie workspace (default) or the generated sample ledger. */
  CASHFLOW_SOURCE: z.enum(['nessie', 'mock']).default('nessie'),

  /* Cash Flow Copilot backend services (Java ledger + Python intelligence). */
  DEMO_MODE: z.stringbool().optional(),
  INTERNAL_SERVICE_TOKEN: z.string().min(8).optional(),
  LEDGER_SERVICE_URL: z.url().default('http://localhost:8080'),
  INTELLIGENCE_SERVICE_URL: z.url().default('http://localhost:8000'),
});

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface PersonaConfig {
  apiKey: string;
  templateId: string;
  apiVersion: string;
  baseUrl: string;
  webhookSecret: string | null;
  /** Treat `completed` as verified when the template has no automated decision step. */
  acceptCompleted: boolean;
}

export interface NessieConfig {
  apiKey: string;
  baseUrl: string;
}

/**
 * The Cash Flow Copilot backend: the Java ledger service (authoritative
 * financial state) and the Python intelligence service (documents, risk,
 * advisor). Express is their BFF; the browser never talks to them directly.
 */
export interface CopilotConfig {
  /** Mirrors the services' DEMO_MODE: seeds the demo business for verified users and allows dev shortcuts. */
  demoMode: boolean;
  /** Shared secret both services require on every internal call. */
  internalServiceToken: string;
  ledgerUrl: string;
  intelligenceUrl: string;
}

export interface AppConfig {
  env: 'development' | 'production' | 'test';
  isProduction: boolean;
  port: number;
  appUrl: string;
  sessionSecret: string;
  google: GoogleConfig | null;
  persona: PersonaConfig | null;
  nessie: NessieConfig | null;
  cashflowSource: 'nessie' | 'mock';
  copilot: CopilotConfig;
  integrations: IntegrationStatus;
  /** Human-readable notes about why an integration is in sandbox mode. */
  notes: string[];
}

function blankToUndefined(env: NodeJS.ProcessEnv): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    out[key] = value?.trim() === '' ? undefined : value;
  }
  return out;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(blankToUndefined(env));
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const e = parsed.data;
  const isProduction = e.NODE_ENV === 'production';
  const notes: string[] = [];

  let sessionSecret = e.SESSION_SECRET;
  if (!sessionSecret) {
    if (isProduction) throw new Error('SESSION_SECRET is required in production.');
    sessionSecret = randomBytes(32).toString('hex');
    notes.push('SESSION_SECRET not set; using a random secret (sessions reset on restart).');
  }

  let google: GoogleConfig | null = null;
  if (e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET) {
    google = {
      clientId: e.GOOGLE_CLIENT_ID,
      clientSecret: e.GOOGLE_CLIENT_SECRET,
      redirectUri: new URL('/api/auth/google/callback', e.APP_URL).toString(),
    };
  } else {
    notes.push('GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not set; Google sign-in runs in sandbox mode.');
  }

  let persona: PersonaConfig | null = null;
  if (e.PERSONA_API_KEY && e.PERSONA_TEMPLATE_ID) {
    persona = {
      apiKey: e.PERSONA_API_KEY,
      templateId: e.PERSONA_TEMPLATE_ID,
      apiVersion: e.PERSONA_API_VERSION,
      baseUrl: e.PERSONA_BASE_URL,
      webhookSecret: e.PERSONA_WEBHOOK_SECRET ?? null,
      acceptCompleted: e.PERSONA_ACCEPT_COMPLETED ?? true,
    };
  } else {
    notes.push('PERSONA_API_KEY / PERSONA_TEMPLATE_ID not set; identity verification runs in sandbox mode.');
  }

  let nessie: NessieConfig | null = null;
  if (e.NESSIE_API_KEY) {
    nessie = { apiKey: e.NESSIE_API_KEY, baseUrl: e.NESSIE_BASE_URL };
  } else {
    notes.push('NESSIE_API_KEY not set; banking data comes from the in-memory Nessie fixture.');
  }

  let internalServiceToken = e.INTERNAL_SERVICE_TOKEN;
  if (!internalServiceToken) {
    if (isProduction) {
      // A random token never matches the services, so the copilot routes fail closed rather than open.
      internalServiceToken = randomBytes(24).toString('hex');
      notes.push('INTERNAL_SERVICE_TOKEN not set; the ledger and intelligence services will reject every call until it is.');
    } else {
      internalServiceToken = 'local-dev-internal-token';
    }
  }
  const demoMode = e.DEMO_MODE ?? !isProduction;
  if (demoMode) notes.push('DEMO_MODE is on: verified users are seeded with the demo business in the ledger service.');

  return {
    env: e.NODE_ENV,
    isProduction,
    port: e.PORT,
    appUrl: e.APP_URL,
    sessionSecret,
    google,
    persona,
    nessie,
    cashflowSource: e.CASHFLOW_SOURCE,
    copilot: {
      demoMode,
      internalServiceToken,
      ledgerUrl: e.LEDGER_SERVICE_URL.replace(/\/+$/, ''),
      intelligenceUrl: e.INTELLIGENCE_SERVICE_URL.replace(/\/+$/, ''),
    },
    integrations: {
      google: google ? 'live' : 'sandbox',
      persona: persona ? 'live' : 'sandbox',
      nessie: nessie ? 'live' : 'sandbox',
    },
    notes,
  };
}
