import { describe, it, expect } from 'vitest';
import { FilesystemSandbox } from '../filesystem-sandbox.js';
import { getDefaultConfig } from '../config.js';
import { platform } from 'os';

const available = platform() === 'linux' && await FilesystemSandbox.isAvailable();
describe.skipIf(!available)('Linux resource limits', () => {
  it('rejects allocations above the configured memory limit', async () => {
    const sandbox = new FilesystemSandbox({ ...getDefaultConfig(process.cwd()), maxMemoryMB: 50 });
    const result = await sandbox.executeCommand(['/usr/bin/perl', '-e', '$x = "x" x (100 * 1024 * 1024); print "allocated"']);
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).not.toContain('allocated');
  });

  it('applies the configured file size and process limits', async () => {
    const sandbox = new FilesystemSandbox({ ...getDefaultConfig(process.cwd()), maxFileSize: 10, maxProcesses: 4096 });
    const result = await sandbox.executeCommand(['/bin/bash', '-c', 'ulimit -f; ulimit -u']);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout.trim().split('\n')).toEqual(['10240', '4096']);
  });

  it('allows commands within the limits', async () => {
    const sandbox = new FilesystemSandbox(getDefaultConfig(process.cwd()));
    const result = await sandbox.executeCommand(['/bin/echo', 'within limits']);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe('within limits');
  });
});
