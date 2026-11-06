// DOCKER TEST (threat model section 5 conditions 2 and 3; T11). Skipped unless
// BROWSER_DOCKER_TESTS=1: it must run inside the sidecar image with the hardened flags.
//   docker/browser/run.sh --memory 2g --memory-swap 2g -v "$PWD/docker/browser/test:/srv/test:ro" \
//     -e BROWSER_DOCKER_TESTS=1 -e HEADLESS_ALLOW_NO_TOKEN=1 --entrypoint node <image> \
//     --test test/syscalls.docker.test.ts
// Raw syscalls come from perl (perl-base is in the Debian base image), so no compiler is needed.
// Each denied call is made twice: from the plain process, and from inside a fresh user
// namespace + mount namespace (the state a compromised renderer can reach, because unshare is
// allowed). In the second case the kernel would grant mount() to the namespace owner, so an
// EPERM there is the seccomp profile and nothing else.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const ON = process.env.BROWSER_DOCKER_TESTS === '1';
const opts = {
  skip: ON ? false : 'needs the hardened sidecar container (set BROWSER_DOCKER_TESTS=1)',
};

const EPERM = 1;
// x86_64 and aarch64 syscall numbers.
const NR: Record<string, Record<string, number>> = {
  x64: { mount: 165, bpf: 321, keyctl: 250, ptrace: 101, open_by_handle_at: 304, unshare: 272 },
  arm64: { mount: 40, bpf: 280, keyctl: 219, ptrace: 117, open_by_handle_at: 265, unshare: 97 },
};
const nr = NR[process.arch];

const CLONE_NEWNS = 0x00020000;
const CLONE_NEWUSER = 0x10000000;

/** Runs `syscall(n, args)` in perl; returns [return value, errno]. `pre` runs first. */
function sys(name: string, args: string, pre = ''): { ret: number; errno: number } {
  const script = `my ($s, $t, $f) = ("none", "/tmp", "tmpfs"); ${pre} my $r = syscall(${nr![name]}, ${args}); print $r, " ", $!+0, "\\n";`;
  const out = execFileSync('perl', ['-e', script], { encoding: 'utf8' }).trim();
  const [ret, errno] = out.split(' ').map(Number);
  return { ret: ret!, errno: errno! };
}

const UNSHARE_USERNS = `die "userns unavailable" if syscall(${nr?.unshare}, ${CLONE_NEWUSER | CLONE_NEWNS}) != 0;`;

// name -> perl argument list (pointers as strings, scalars as ints).
const CALLS: Record<string, string> = {
  mount: '$s, $t, $f, 0, 0',
  bpf: '0, 0, 0', // BPF_MAP_CREATE with a null attr
  keyctl: '-1, 0, 0, 0, 0', // invalid command: would be EOPNOTSUPP if the call were allowed
  ptrace: '16, 1, 0, 0', // PTRACE_ATTACH to pid 1
  open_by_handle_at: '-100, 0, 0',
};

test('this architecture has a syscall table', opts, () => {
  assert.ok(nr, `no syscall numbers for ${process.arch}`);
});

for (const [name, args] of Object.entries(CALLS)) {
  test(`${name} returns EPERM`, opts, () => {
    const r = sys(name, args);
    assert.equal(r.ret, -1);
    assert.equal(r.errno, EPERM);
  });
  test(`${name} returns EPERM inside a fresh user + mount namespace`, opts, () => {
    const r = sys(name, args, UNSHARE_USERNS);
    assert.equal(r.ret, -1);
    assert.equal(r.errno, EPERM);
  });
}

test(
  'control: unshare of a user namespace works, so the namespace tests are not vacuous',
  opts,
  () => {
    // A user namespace can be created (unshare is allowed), yet mount stays denied inside it.
    const r = sys('mount', '0, 0, 0, 0, 0', UNSHARE_USERNS);
    assert.equal(r.errno, EPERM); // still denied after a successful unshare
    const out = execFileSync(
      'perl',
      ['-e', `die "no" if syscall(${nr!.unshare}, ${CLONE_NEWUSER}) != 0; print "ok\\n";`],
      { encoding: 'utf8' },
    );
    assert.equal(out.trim(), 'ok');
  },
);

// Condition 3: the capability set inside the container is exactly SYS_CHROOT (bit 18).
test(
  'capability bounding set is exactly CAP_SYS_CHROOT, no new privileges, seccomp filter on',
  opts,
  () => {
    const status = readFileSync('/proc/self/status', 'utf8');
    const field = (k: string) => new RegExp(`^${k}:\\s*(\\S+)`, 'm').exec(status)?.[1];
    assert.equal(field('CapBnd'), '0000000000040000');
    assert.equal(field('CapEff'), '0000000000000000'); // non-root: nothing effective
    assert.equal(field('CapAmb'), '0000000000000000');
    assert.equal(field('NoNewPrivs'), '1');
    assert.equal(field('Seccomp'), '2'); // filter mode
    assert.equal(process.getuid?.(), 10001);
  },
);
