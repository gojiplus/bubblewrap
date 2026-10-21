import { realpathSync } from 'fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'path';

export function canonicalPath(path: string): string {
  const absolute = resolve(path);
  try {
    return realpathSync(absolute);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const parent = dirname(absolute);
    if (parent === absolute) return absolute;
    return join(canonicalPath(parent), relative(parent, absolute));
  }
}

export function isWithinPath(path: string, root: string): boolean {
  const child = relative(canonicalPath(root), canonicalPath(path));
  return child === '' || (child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child));
}
