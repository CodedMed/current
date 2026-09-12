import type { AppConfig } from '../../config.ts';
import { InMemoryNessieClient } from './fixtureClient.ts';
import { HttpNessieClient } from './nessieClient.ts';
import type { NessieApi } from './types.ts';

export function createNessieApi(config: AppConfig): NessieApi {
  return config.nessie ? new HttpNessieClient(config.nessie) : new InMemoryNessieClient();
}

export type { NessieApi } from './types.ts';
export { Provisioner } from './provisioner.ts';
export { fetchSnapshot } from './snapshot.ts';
