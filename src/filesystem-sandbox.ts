/**
 * Filesystem sandboxing using bubblewrap
 */

import { spawn } from 'child_process';
import { existsSync, statSync } from 'fs';
import { isWithinPath } from './path-access.js';
import { SandboxConfig, CommandResult, ExecuteOptions } from './types.js';

export class FilesystemSandbox {
  constructor(private config: SandboxConfig) {}

  /**
   * Execute a command inside bubblewrap sandbox
   */
  async executeCommand(
    command: string[],
    options: ExecuteOptions = {}
  ): Promise<CommandResult> {
    const startTime = Date.now();

    const bwrapArgs = this.buildBubblewrapArgs(command, options);

    return new Promise((resolve, reject) => {
      const proc = spawn('bwrap', bwrapArgs, {
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
        reject(new Error(`Failed to spawn bubblewrap: ${error.message}`));
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
   * Build resource-limited command wrapper
   */
  private buildResourceLimitedCommand(command: string[]): string[] {
    const ulimitCommands: string[] = [];

    // Set memory limit (virtual memory in KB)
    if (this.config.maxMemoryMB) {
      const memoryKB = this.config.maxMemoryMB * 1024;
      ulimitCommands.push(`ulimit -v ${memoryKB}`);
    }

    // Set max file size (in KB)
    if (this.config.maxFileSize) {
      const fileSizeKB = this.config.maxFileSize * 1024;
      ulimitCommands.push(`ulimit -f ${fileSizeKB}`);
    }

    // Set max processes
    if (this.config.maxProcesses) {
      ulimitCommands.push(`ulimit -u ${this.config.maxProcesses}`);
    }

    // Set CPU time limit (if maxCPUPercent is set, use it as seconds for now)
    // Note: ulimit -t sets CPU time, not percentage
    // For true CPU % limiting, we'd need cgroups
    if (this.config.maxCPUPercent) {
      // This is a simplified approach - just limit total CPU seconds
      // A more sophisticated approach would use cgroups
      const cpuSeconds = Math.floor(this.config.maxCPUPercent * 10); // Rough approximation
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
   * Build bubblewrap command line arguments
   */
  private buildBubblewrapArgs(
    command: string[],
    options: ExecuteOptions
  ): string[] {
    const args: string[] = [
      '--unshare-all', '--share-net', '--die-with-parent',
      '--proc', '/proc', '--dev', '/dev', '--tmpfs', this.config.tmpDir,
    ];

    // Add read-only binds for system paths
    for (const path of this.config.allowedReadPaths) {
      if (path !== this.config.workingDir) {
        args.push('--ro-bind-try', path, path);
      }
    }

    // Add read-write binds for allowed write paths
    for (const path of this.config.allowedWritePaths) {
      args.push('--bind', path, path);
    }

    // Bind resolv.conf for DNS (read-only)
    args.push('--ro-bind-try', '/etc/resolv.conf', '/etc/resolv.conf');
    args.push('--ro-bind-try', '/etc/hosts', '/etc/hosts');

    for (const path of this.config.deniedPaths) {
      if (!existsSync(path)) continue;
      const exposed = [...this.config.allowedReadPaths, ...this.config.allowedWritePaths]
        .some((allowed) => isWithinPath(path, allowed));
      if (!exposed) continue;
      if (statSync(path).isDirectory()) args.push('--tmpfs', path, '--remount-ro', path);
      else args.push('--ro-bind', '/dev/null', path);
    }

    args.push('--remount-ro', '/');

    // Set working directory
    const cwd = options.cwd || this.config.workingDir;
    args.push('--chdir', cwd);

    // Wrap command with resource limits if configured
    const finalCommand = this.buildResourceLimitedCommand(command);

    // Add the command to execute
    args.push(...finalCommand);

    return args;
  }

  /**
   * Check if bubblewrap is available
   */
  static async isAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn('bwrap', ['--unshare-all', '--ro-bind', '/', '/', '/bin/true']);
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
