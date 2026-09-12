import type { AppConfig } from './config.ts';
import { GoogleAuthProvider } from './modules/auth/googleProvider.ts';
import { SandboxAuthProvider } from './modules/auth/sandboxProvider.ts';
import type { AuthProvider } from './modules/auth/types.ts';
import { PersonaIdentityService } from './modules/identity/personaService.ts';
import { SandboxIdentityService } from './modules/identity/sandboxIdentityService.ts';
import type { IdentityService } from './modules/identity/types.ts';
import { createNessieApi } from './modules/nessie/index.ts';
import { Provisioner } from './modules/nessie/provisioner.ts';
import type { NessieApi } from './modules/nessie/types.ts';
import { InMemoryUserRepository, type UserRepository } from './store/userStore.ts';

/**
 * Composition root. Every integration is chosen here based on which
 * credentials exist, so the rest of the app depends only on interfaces.
 */
export interface Services {
  config: AppConfig;
  users: UserRepository;
  auth: AuthProvider;
  identity: IdentityService;
  nessie: NessieApi;
  provisioner: Provisioner;
}

export function createServices(config: AppConfig): Services {
  const users = new InMemoryUserRepository();
  const auth: AuthProvider = config.google ? new GoogleAuthProvider(config.google) : new SandboxAuthProvider(config.appUrl);
  const identity: IdentityService = config.persona
    ? new PersonaIdentityService(config.persona, users)
    : new SandboxIdentityService(users);
  const nessie = createNessieApi(config);
  const provisioner = new Provisioner(nessie, users);
  return { config, users, auth, identity, nessie, provisioner };
}
