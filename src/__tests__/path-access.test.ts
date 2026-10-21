import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { FilesystemSandbox } from '../filesystem-sandbox.js';
import { MacOSSandbox } from '../macos-sandbox.js';
import { getDefaultConfig } from '../config.js';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));
describe.each([FilesystemSandbox, MacOSSandbox])('%s path boundaries', (Sandbox) => {
  it('rejects prefix siblings, parent traversal, and symlink escapes', () => {
    const root = mkdtempSync(join(tmpdir(), 'sandbox-path-'));
    roots.push(root);
    const work = join(root, 'work');
    const outside = join(root, 'outside');
    mkdirSync(work); mkdirSync(outside);
    symlinkSync(outside, join(work, 'link'));
    const sandbox = new Sandbox(getDefaultConfig(work));
    expect(sandbox.isWriteAllowed(join(work, 'new.txt'))).toBe(true);
    for (const path of [work + '-sibling/file', join(work, '../outside/file'), join(work, 'link/new.txt')]) {
      expect(sandbox.isWriteAllowed(path)).toBe(false);
      expect(sandbox.isReadAllowed(path)).toBe(false);
    }
  });
});
