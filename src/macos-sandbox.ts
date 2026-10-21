/**
 * macOS sandboxing using sandbox-exec and Seatbelt profiles
 */

import { spawn } from 'child_process';
import { mkdtemp, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { canonicalPath, isWithinPath } from './path-access.js';
import { SandboxConfig, CommandResult, ExecuteOptions } from './types.js';

export class MacOSSandbox {
  constructor(private config: SandboxConfig) {}

  /**
   * Execute a command inside macOS sandbox
   */
  async executeCommand(
    command: string[],
    options: ExecuteOptions = {}
  ): Promise<CommandResult> {
    const profilePath = await this.createSandboxProfile();

    try {
      const result = await this.runSandboxed(command, profilePath, options);
      return result;
    } finally {
      // Clean up profile file
      await rm(dirname(profilePath), { recursive: true }).catch(() => {
        // Ignore cleanup errors
      });
    }
  }

  /**
   * Create temporary Seatbelt profile
   */
  private async createSandboxProfile(): Promise<string> {
    const profile = this.generateSeatbeltProfile();
    const directory = await mkdtemp(join(tmpdir(), 'bubblewrap-profile-'));
    const profilePath = join(directory, 'profile.sb');
    await writeFile(profilePath, profile, { encoding: 'utf-8', mode: 0o600 });
    return profilePath;
  }

  /**
   * Generate Seatbelt sandbox profile
   */
  private generateSeatbeltProfile(): string {
    const subpaths = (paths: string[]) => paths
      .map((path) => `(subpath ${JSON.stringify(canonicalPath(path))})`)
      .join('\n');
    return `
(version 1)
(deny default)
(import "system.sb")
(allow process*)
(allow sysctl-read)
(allow mach-lookup)
(allow ipc*)
(allow network*)
(allow signal (target self))
(allow file-read-metadata)
(allow file-read* file-map-executable
${subpaths([...this.config.allowedReadPaths, ...this.config.allowedWritePaths,
  '/System', '/Library/Frameworks', '/dev/null', '/dev/urandom', '/dev/random'])}
)
(allow file-read* file-write*
${subpaths([...this.config.allowedWritePaths, this.config.tmpDir])}
)
${this.config.deniedPaths.length ? `(deny file-read* file-write* ${subpaths(this.config.deniedPaths)})` : ''}
`;
  }

  /**
   * Build resource-limited command wrapper
   */
  private buildResourceLimitedCommand(command: string[]): string[] {
    const ulimitCommands: string[] = [];

    // Note: ulimit -v (virtual memory) is not supported on macOS
    // We skip memory limits on macOS as they cause "Invalid argument" errors

    // Set max file size (in KB)
    if (this.config.maxFileSize) {
      const fileSizeKB = this.config.maxFileSize * 1024;
      ulimitCommands.push(`ulimit -f ${fileSizeKB}`);
    }

    // Set max processes
    if (this.config.maxProcesses) {
      ulimitCommands.push(`ulimit -u ${this.config.maxProcesses}`);
    }

    // Set CPU time limit
    if (this.config.maxCPUPercent) {
      const cpuSeconds = Math.floor(this.config.maxCPUPercent * 10);
      ulimitCommands.push(`ulimit -t ${cpuSeconds}`);
    }

    // If we have ulimit commands, wrap the command in a shell
    if (ulimitCommands.length > 0) {
      const commandStr = command.map(arg => {
        // Escape single quotes in arguments
        const escaped = arg.replace(/'/g, "'\\''");
        return `'${escaped}'`;
      }).join(' ');

      const wrappedCommand = `${ulimitCommands.join(' && ')} && exec ${commandStr}`;
      return ['/bin/bash', '-c', wrappedCommand];
    }

    return command;
  }

  /**
   * Run command with sandbox-exec
   */
  private async runSandboxed(
    command: string[],
    profilePath: string,
    options: ExecuteOptions
  ): Promise<CommandResult> {
    const startTime = Date.now();

    // Wrap command with resource limits if configured
    const finalCommand = this.buildResourceLimitedCommand(command);

    return new Promise((resolve, reject) => {
      const proc = spawn('sandbox-exec', ['-f', profilePath, ...finalCommand], {
        cwd: options.cwd || this.config.workingDir,
        env: options.env || process.env,
      });

      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('error', (error) => {
        reject(new Error(`Failed to spawn sandbox-exec: ${error.message}`));
      });

      proc.on('close', (code) => {
        const duration = Date.now() - startTime;
        resolve({
          exitCode: code ?? 1,
          stdout,
          stderr,
          duration,
        });
      });

      // Handle timeout
      if (options.timeout) {
        setTimeout(() => {
          proc.kill('SIGTERM');
          setTimeout(() => proc.kill('SIGKILL'), 5000);
        }, options.timeout);
      }
    });
  }

  /**
   * Check if sandbox-exec is available
   */
  static async isAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn('sandbox-exec', ['-p', '(version 1)(allow default)', '/usr/bin/true']);
      proc.on('close', (code) => resolve(code === 0));
      proc.on('error', () => resolve(false));
    });
  }

  /**
   * Validate path is allowed for reading
   */
  isReadAllowed(path: string): boolean {
    // Check if path is in denied list
    if (this.config.deniedPaths.some((denied) => isWithinPath(path, denied))) {
      return false;
    }

    // Check if path is in allowed read paths
    return this.config.allowedReadPaths.some((allowed) =>
      isWithinPath(path, allowed)
    );
  }

  /**
   * Validate path is allowed for writing
   */
  isWriteAllowed(path: string): boolean {
    // Check if path is in denied list
    if (this.config.deniedPaths.some((denied) => isWithinPath(path, denied))) {
      return false;
    }

    // Check if path is in allowed write paths
    return this.config.allowedWritePaths.some((allowed) =>
      isWithinPath(path, allowed)
    );
  }
}
