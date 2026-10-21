import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { PlatformSandbox } from '../platform-sandbox.js';
import { getDefaultConfig } from '../config.js';

const available = await PlatformSandbox.isAvailable();
if (process.env.REQUIRE_SANDBOX_TESTS === '1' && !available) {
  throw new Error('The required operating-system sandbox is not usable');
}

describe.skipIf(!available)('Operating-system filesystem isolation', () => {
  let root: string;
  let work: string;
  let denied: string;
  let outside: string;
  let sandbox: PlatformSandbox;

  beforeAll(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'bubblewrap-security-')));
    work = join(root, 'work');
    denied = join(work, 'denied');
    outside = join(root, 'outside.txt');
    for (const path of [work, denied, join(root, 'scratch')]) mkdirSync(path, { recursive: true });
    writeFileSync(join(denied, 'fixture.txt'), 'private-fixture');
    writeFileSync(outside, 'outside-fixture');
    sandbox = new PlatformSandbox({
      ...getDefaultConfig(work),
      deniedPaths: [denied],
      tmpDir: join(root, 'scratch'),
      maxMemoryMB: undefined, maxProcesses: undefined,
      maxCPUPercent: undefined, maxFileSize: undefined,
    });
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('allows reading and writing in the working directory', async () => {
    const file = join(work, 'allowed.txt');
    const result = await sandbox.executeCommand(['/bin/sh', '-c', 'printf allowed > "$1"', 'sh', file]);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(readFileSync(file, 'utf8')).toBe('allowed');
    const read = await sandbox.executeCommand(['/bin/cat', file]);
    expect(read.exitCode, read.stderr).toBe(0);
    expect(read.stdout).toBe('allowed');
  });

  it('blocks a denied directory inside the allowed working directory', async () => {
    const file = join(denied, 'fixture.txt');
    expect(sandbox.isReadAllowed(file)).toBe(false);
    const result = await sandbox.executeCommand(['/bin/cat', file]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).not.toContain('private-fixture');
  });

  it('blocks writes to a denied file inside the working directory', async () => {
    const file = join(denied, 'fixture.txt');
    const result = await sandbox.executeCommand(['/bin/sh', '-c', 'printf changed > "$1"', 'sh', file]);
    expect(result.exitCode).not.toBe(0);
    expect(readFileSync(file, 'utf8')).toBe('private-fixture');
  });

  it('blocks reading an existing file outside allowed paths', async () => {
    const result = await sandbox.executeCommand(['/bin/cat', outside]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).not.toContain('outside-fixture');
  });

  it('blocks writes outside allowed paths, including subprocesses', async () => {
    const result = await sandbox.executeCommand(['/bin/sh', '-c', 'printf changed > "$1"', 'sh', outside]);
    expect(result.exitCode).not.toBe(0);
    expect(readFileSync(outside, 'utf8')).toBe('outside-fixture');
  });
});
