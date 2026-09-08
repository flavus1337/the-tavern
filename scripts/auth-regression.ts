import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

// Run with: pnpm exec tsx scripts/auth-regression.ts
// All state and injected filesystem failures are confined to this temporary root.
async function main(): Promise<void> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tavern-auth-'));
  process.env['DATA_DIR'] = path.join(root, 'auth');
  process.env['CAMPAIGNS_DIR'] = path.join(root, 'campaigns');
  process.env['CLIENT_DIST'] = path.join(root, 'no-client');
  process.env['COOKIE_SECURE'] = 'false';
  let server: http.Server | undefined;
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
  process.on('unhandledRejection', onUnhandled);
  let checks = 0;
  const passed = (label: string) => { console.log(`PASS ${++checks}: ${label}`); };

  async function failRenameOnce<T>(file: string, action: () => Promise<T>): Promise<T> {
    const rename = fs.rename;
    let injected = false;
    fs.rename = async (from, to) => {
      if (!injected && to.toString() === file) {
        injected = true;
        throw Object.assign(new Error('injected rename failure'), { code: 'EIO' });
      }
      return rename(from, to);
    };
    try { return await action(); }
    finally { fs.rename = rename; assert.ok(injected, `fault reached ${file}`); }
  }

  try {
    const { JsonFileStore } = await import('../packages/server/src/data/jsonStore.js');
    const { withCampaignFiles } = await import('../packages/server/src/campaign/commit.js');
    const counterDir = path.join(root, 'counter');
    const counterFile = path.join(counterDir, 'counter.json');
    const counter = await JsonFileStore.create(counterFile, { count: 0 });
    await counter.mutate((value) => value);
    const originalCounter = await fs.readFile(counterFile, 'utf8');

    await assert.rejects(failRenameOnce(counterFile, () => counter.mutate((value) => {
      value.count++;
      return value;
    })), /injected rename failure/);
    assert.equal(counter.get().count, 0);
    assert.equal(await fs.readFile(counterFile, 'utf8'), originalCounter);
    passed('failed mutation rejects and preserves confirmed memory and disk');

    await assert.rejects(counter.mutate((value) => {
      value.count = 99;
      throw new Error('callback failed');
    }), /callback failed/);
    assert.equal(counter.get().count, 0);
    await Promise.all(Array.from({ length: 8 }, () => counter.mutate((value) => ({ count: value.count + 1 }))));
    assert.equal(counter.get().count, 8);
    assert.equal(JSON.parse(await fs.readFile(counterFile, 'utf8')).count, 8);
    passed('queue recovers after errors and serializes concurrent callbacks');

    await withCampaignFiles(counterDir, async () => {
      await counter.mutate((value) => ({ count: value.count + 1 }));
      assert.equal(counter.get().count, 9);
      await counter.mutate((value) => ({ count: value.count + 1 }));
      assert.equal(counter.get().count, 10);
    });
    assert.equal(counter.get().count, 10);
    assert.equal(JSON.parse(await fs.readFile(counterFile, 'utf8')).count, 10);
    await assert.rejects(failRenameOnce(counterFile, () => withCampaignFiles(counterDir, async () => {
      await counter.mutate((value) => ({ count: value.count + 1 }));
      await counter.mutate((value) => ({ count: value.count + 1 }));
    })), /injected rename failure/);
    assert.equal(counter.get().count, 10);
    assert.equal(JSON.parse(await fs.readFile(counterFile, 'utf8')).count, 10);
    passed('same-store mutations share a transaction candidate and roll back together');

    const corrupt = path.join(root, 'corrupt', 'data.json');
    await fs.mkdir(path.dirname(corrupt));
    await fs.writeFile(corrupt, '{broken');
    await assert.rejects(JsonFileStore.create(corrupt, { count: 0 }), SyntaxError);
    assert.equal(await fs.readFile(corrupt, 'utf8'), '{broken');
    passed('malformed existing JSON is preserved and rejected');

    const users = await import('../packages/server/src/auth/users.js');
    const sessions = await import('../packages/server/src/auth/sessions.js');
    const memberships = await import('../packages/server/src/auth/memberships.js');
    const invites = await import('../packages/server/src/auth/invites.js');
    await users.initUsersStore();
    await sessions.initSessionsStore();
    await memberships.initMembershipsStore();
    await invites.initInvitesStore();

    const password = 'test-password-123';
    const user = await users.createUser('tester', password);
    const duplicate = await Promise.allSettled([
      users.createUser('Duplicate', password), users.createUser('duplicate', password),
    ]);
    assert.equal(duplicate.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(users.getStore().get().users.filter((record) => record.username.toLowerCase() === 'duplicate').length, 1);
    passed('concurrent normalized usernames persist only once');

    await Promise.all([
      memberships.addMembership('idempotent', user.id, 'player'),
      memberships.addMembership('idempotent', user.id, 'player'),
    ]);
    assert.equal(memberships.listForCampaign('idempotent').length, 1);
    const limited = await invites.createInvite('limited', user.id, { maxUses: 1 });
    const attempts = await Promise.all([
      invites.redeemInvite(limited.token, 'player-a'),
      invites.redeemInvite(limited.token, 'player-b'),
    ]);
    assert.equal(attempts.filter((attempt) => attempt.ok).length, 1);
    assert.equal(memberships.listForCampaign('limited').length, 1);
    assert.equal(invites.getInvitesStore().get().invites.find((invite) => invite.token === limited.token)?.uses, 1);
    passed('membership addition is idempotent and invite capacity is serialized');

    const dataDir = process.env['DATA_DIR']!;
    const membershipFile = path.join(dataDir, 'memberships.json');
    const inviteFile = path.join(dataDir, 'invites.json');
    const recoverable = await invites.createInvite('recoverable', user.id, { maxUses: 1 });
    const beforeInvites = await fs.readFile(inviteFile, 'utf8');
    const beforeMemberships = await fs.readFile(membershipFile, 'utf8');
    for (const failedFile of [membershipFile, inviteFile]) {
      await assert.rejects(failRenameOnce(failedFile, () => invites.redeemInvite(recoverable.token, 'recovering-player')), /injected rename failure/);
      assert.equal(await fs.readFile(inviteFile, 'utf8'), beforeInvites);
      assert.equal(await fs.readFile(membershipFile, 'utf8'), beforeMemberships);
      assert.equal(memberships.getRole('recoverable', 'recovering-player'), null);
      assert.equal(invites.getInvitesStore().get().invites.find((invite) => invite.token === recoverable.token)?.uses, 0);
    }
    assert.deepEqual(await invites.redeemInvite(recoverable.token, 'recovering-player'), { ok: true, campaignId: 'recoverable' });
    passed('failure of either invite or membership file restores both files and memory; retry succeeds');

    const { createApp } = await import('../packages/server/src/http/app.js');
    server = http.createServer(createApp());
    await new Promise<void>((resolve) => { server!.listen(0, '127.0.0.1', resolve); });
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}`;
    const post = (route: string, body: unknown, cookie?: string) => fetch(`${base}${route}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(2000),
    });

    for (const body of [{ username: {}, password }, { username: 'tester', password: [] }, { username: 'tester', password, inviteToken: {} }, null]) {
      const response = await post('/api/auth/login', body);
      assert.equal(response.status, 400);
      await response.text();
    }
    const invalidJson = await fetch(`${base}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{broken', signal: AbortSignal.timeout(2000),
    });
    assert.equal(invalidJson.status, 400);
    await invalidJson.text();
    passed('malformed auth primitives and JSON return 400 promptly');

    const sessionFile = path.join(dataDir, 'sessions.json');
    const initialSession = await sessions.createSession(user.id);
    const loginInvite = await invites.createInvite('login-atomic', user.id, { maxUses: 1 });
    const sessionBefore = await fs.readFile(sessionFile, 'utf8');
    await failRenameOnce(sessionFile, async () => {
      const response = await post('/api/auth/login', { username: 'tester', password, inviteToken: loginInvite.token });
      assert.equal(response.status, 500);
      assert.equal(response.headers.get('set-cookie'), null);
      await response.text();
    });
    assert.equal(await fs.readFile(sessionFile, 'utf8'), sessionBefore);
    assert.equal(sessions.getSessionsStore().get().sessions.length, 1);
    assert.equal(memberships.getRole('login-atomic', user.id), null);
    assert.equal(invites.getInvitesStore().get().invites.find((invite) => invite.token === loginInvite.token)?.uses, 0);
    passed('failed session persistence returns no login success or cookie and rolls back invite redemption');

    await failRenameOnce(sessionFile, async () => {
      const response = await post('/api/auth/logout', {}, `vtt_session=${initialSession.token}`);
      assert.equal(response.status, 500);
      assert.equal(response.headers.get('set-cookie'), null);
      await response.text();
    });
    assert.ok(sessions.resolveSession(initialSession.token));
    assert.equal(await fs.readFile(sessionFile, 'utf8'), sessionBefore);
    const logout = await post('/api/auth/logout', {}, `vtt_session=${initialSession.token}`);
    assert.equal(logout.status, 204);
    assert.match(logout.headers.get('set-cookie') ?? '', /Max-Age=0/);
    assert.equal(sessions.resolveSession(initialSession.token), null);
    assert.deepEqual(JSON.parse(await fs.readFile(sessionFile, 'utf8')).sessions, []);
    passed('failed logout keeps its session; successful retry durably removes it');

    const registrationInvite = await invites.createInvite('registration', user.id);
    const userFile = path.join(dataDir, 'users.json');
    await failRenameOnce(userFile, async () => {
      const response = await post('/api/auth/register', { username: 'new-user', password, inviteToken: registrationInvite.token });
      assert.equal(response.status, 500);
      assert.equal(response.headers.get('set-cookie'), null);
      await response.text();
    });
    assert.equal(users.findUserByUsername('new-user'), undefined);
    passed('registration storage failures are server errors and do not publish an account');

    const atomicInvite = await invites.createInvite('atomic-registration', user.id, { maxUses: 1 });
    const authFiles = [userFile, inviteFile, membershipFile, sessionFile];
    const beforeRegistration = await Promise.all(authFiles.map((file) => fs.readFile(file, 'utf8')));
    await failRenameOnce(sessionFile, async () => {
      const response = await post('/api/auth/register', { username: 'atomic-user', password, inviteToken: atomicInvite.token });
      assert.equal(response.status, 500);
      assert.equal(response.headers.get('set-cookie'), null);
      await response.text();
    });
    assert.deepEqual(await Promise.all(authFiles.map((file) => fs.readFile(file, 'utf8'))), beforeRegistration);
    assert.equal(users.findUserByUsername('atomic-user'), undefined);
    assert.equal(memberships.listForCampaign('atomic-registration').length, 0);
    assert.equal(invites.getInvitesStore().get().invites.find((invite) => invite.token === atomicInvite.token)?.uses, 0);
    const registered = await post('/api/auth/register', { username: 'atomic-user', password, inviteToken: atomicInvite.token });
    assert.equal(registered.status, 201);
    assert.ok(registered.headers.get('set-cookie'));
    await registered.text();
    assert.ok(users.findUserByUsername('atomic-user'));
    assert.equal(memberships.listForCampaign('atomic-registration').length, 1);
    passed('late registration failure restores all four auth files and leaves the username/invite reusable');

    const racingInvite = await invites.createInvite('registration-race', user.id, { maxUses: 1 });
    const racingResponses = await Promise.all(['race-one', 'race-two'].map((username) =>
      post('/api/auth/register', { username, password, inviteToken: racingInvite.token })));
    assert.deepEqual(racingResponses.map((response) => response.status).sort(), [201, 410]);
    for (const response of racingResponses) {
      if (response.status !== 201) assert.equal(response.headers.get('set-cookie'), null);
      await response.text();
    }
    assert.equal(users.getStore().get().users.filter((record) => ['race-one', 'race-two'].includes(record.username)).length, 1);
    assert.equal(memberships.listForCampaign('registration-race').length, 1);
    assert.equal(invites.getInvitesStore().get().invites.find((invite) => invite.token === racingInvite.token)?.uses, 1);
    passed('concurrent registration for a one-use invite leaves no losing account or session');

    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(unhandled, []);
    passed('no unhandled promise rejections');
    console.log(`Auth regression complete: ${checks} checks passed`);
  } finally {
    if (server) {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => { server!.close((err) => err ? reject(err) : resolve()); });
    }
    process.off('unhandledRejection', onUnhandled);
    await fs.rm(root, { recursive: true, force: true });
  }
}

main().then(() => process.exit(0), (err: unknown) => {
  console.error(err);
  process.exit(1);
});
