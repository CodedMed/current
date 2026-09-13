import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import type { PersonaConfig } from '../../config.ts';
import { InMemoryUserRepository, type AuthProfile, type UserRecord } from '../../store/userStore.ts';
import { PersonaIdentityService } from './personaService.ts';

const CONFIG: PersonaConfig = {
  apiKey: 'persona_sandbox_test',
  templateId: 'itmpl_test',
  apiVersion: '2025-12-08',
  baseUrl: 'https://persona.test',
  webhookSecret: null,
  acceptCompleted: true,
};

const PROFILE: AuthProfile = {
  provider: 'google',
  subject: 'sub-1',
  email: 'owner@example.com',
  emailVerified: true,
  name: 'Jordan Rivera',
  givenName: 'Jordan',
  familyName: 'Rivera',
  picture: null,
};

/** Persona's JSON:API envelope for one inquiry. */
function inquiry(id: string, status: string) {
  return { data: { id, type: 'inquiry', attributes: { status, 'reference-id': 'ref' } }, meta: { 'session-token': 'tok' } };
}

interface Call {
  url: string;
  method: string;
}

/** Replaces global fetch with a router over `url -> [status, body]`, recording every call. */
function stubFetch(routes: (url: string, method: string) => [number, unknown]): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (url: string | URL, init?: { method?: string }) => {
    const method = init?.method ?? 'GET';
    calls.push({ url: String(url), method });
    const [status, body] = routes(String(url), method);
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  return calls;
}

async function userWithInquiry(users: InMemoryUserRepository, inquiryId: string | null): Promise<UserRecord> {
  const user = await users.upsertFromProfile(PROFILE, 'live');
  return users.update(user.id, (u) => {
    u.identity = { mode: 'live', status: 'pending', inquiryId, detail: null, updatedAt: new Date().toISOString() };
  });
}

describe('PersonaIdentityService', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('starts a new inquiry when the stored one is unknown to Persona', async () => {
    // A sandbox id left over from before a real key was configured: Persona answers 404.
    const calls = stubFetch((url, method) => {
      if (method === 'POST' && url.endsWith('/api/v1/inquiries')) return [201, inquiry('inq_live', 'created')];
      return [404, { errors: [{ title: 'Record not found' }] }];
    });
    const users = new InMemoryUserRepository();
    const user = await userWithInquiry(users, 'inq_sandbox_deadbeef');

    const session = await new PersonaIdentityService(CONFIG, users).startSession(user);

    assert.equal(session.inquiryId, 'inq_live');
    assert.equal(session.sessionToken, 'tok');
    assert.ok(calls.some((c) => c.method === 'POST' && c.url.endsWith('/api/v1/inquiries')));
    assert.equal((await users.get(user.id))?.identity.inquiryId, 'inq_live');
  });

  it('resumes a stored inquiry that Persona still knows', async () => {
    const calls = stubFetch((url) => {
      if (url.endsWith('/resume')) return [200, inquiry('inq_known', 'pending')];
      return [200, inquiry('inq_known', 'pending')];
    });
    const users = new InMemoryUserRepository();
    const user = await userWithInquiry(users, 'inq_known');

    const session = await new PersonaIdentityService(CONFIG, users).startSession(user);

    assert.equal(session.inquiryId, 'inq_known');
    assert.equal(session.sessionToken, 'tok');
    assert.ok(!calls.some((c) => c.method === 'POST' && c.url.endsWith('/api/v1/inquiries')));
  });

  it('forgets a stored inquiry that Persona does not have when refreshing', async () => {
    stubFetch(() => [404, { errors: [{ title: 'Record not found' }] }]);
    const users = new InMemoryUserRepository();
    const user = await userWithInquiry(users, 'inq_sandbox_deadbeef');

    const outcome = await new PersonaIdentityService(CONFIG, users).refresh(user);

    assert.equal(outcome.status, 'not_started');
    assert.equal(outcome.inquiryId, null);
    assert.equal((await users.get(user.id))?.identity.inquiryId, null);
  });

  it('still surfaces other Persona failures', async () => {
    stubFetch(() => [401, { errors: [{ title: 'Must be authenticated to access this endpoint' }] }]);
    const users = new InMemoryUserRepository();
    const user = await userWithInquiry(users, 'inq_known');

    await assert.rejects(() => new PersonaIdentityService(CONFIG, users).startSession(user), /API key/);
  });
});
