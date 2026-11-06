import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FORBIDDEN_FLAGS,
  SandboxError,
  assertLaunchArgs,
  evaluateSandbox,
  selfCheck,
  type Probe,
} from '../src/sandbox.ts';
import { BASE_ARGS } from '../src/browser.ts';

const ok: Probe = {
  uid: 10001,
  maxUserNamespaces: 1000,
  ownUserNs: 'user:[1]',
  chromeProcs: [
    { cmdline: ['/ms-playwright/headless_shell', '--headless'], userNs: 'user:[1]' },
    { cmdline: ['/ms-playwright/headless_shell', '--type=renderer'], userNs: 'user:[2]' },
  ],
};

test('forbidden flag list covers the sandbox-weakening flags', () => {
  assert.equal(FORBIDDEN_FLAGS.length, 3);
  for (const f of FORBIDDEN_FLAGS) assert.throws(() => assertLaunchArgs([f]), SandboxError);
  assert.throws(() => assertLaunchArgs([FORBIDDEN_FLAGS[0] + '=1']), SandboxError);
});

test('the launch arguments the server uses are clean', () => {
  assertLaunchArgs(BASE_ARGS);
});

test('sandbox active: passes', () => evaluateSandbox(ok));

test('fails closed: root, no chrome, forbidden flag, no user namespace isolation', () => {
  assert.throws(() => evaluateSandbox({ ...ok, uid: 0 }), /root/);
  assert.throws(() => evaluateSandbox({ ...ok, chromeProcs: [] }), SandboxError);
  assert.throws(
    () =>
      evaluateSandbox({
        ...ok,
        chromeProcs: [{ cmdline: ['chrome', FORBIDDEN_FLAGS[0]], userNs: 'user:[2]' }],
      }),
    /forbidden/,
  );
  assert.throws(
    () => evaluateSandbox({ ...ok, chromeProcs: [{ cmdline: ['chrome'], userNs: 'user:[1]' }] }),
    /not active/,
  );
});

test('selfCheck: root refuses before launching; launch failure reports unsupported host', async () => {
  let launched = false;
  const launch = async () => {
    launched = true;
    throw new Error('No usable sandbox');
  };
  await assert.rejects(
    selfCheck(launch, () => ({ ...ok, uid: 0 })),
    /root/,
  );
  assert.equal(launched, false);
  await assert.rejects(
    selfCheck(launch, () => ({ ...ok, maxUserNamespaces: 0 })),
    /max_user_namespaces=0/,
  );
  await assert.rejects(
    selfCheck(launch, () => ok),
    /sandbox could not start/,
  );
});
