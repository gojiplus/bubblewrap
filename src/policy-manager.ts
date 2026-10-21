/**
 * Policy manager for granular filesystem and network isolation
 */

import { SandboxPolicy } from './enhanced-types.js';
import { minimatch } from 'minimatch';

export class PolicyManager {
  private policy: SandboxPolicy;

  constructor(policy: SandboxPolicy) {
    this.policy = policy;
  }

  // Filesystem checks

  canRead(path: string): boolean {
    return this.checkPath(
      path,
      this.policy.filesystem.allowRead,
      this.policy.filesystem.denyRead
    );
  }

  canWrite(path: string): boolean {
    return this.checkPath(
      path,
      this.policy.filesystem.allowWrite,
      this.policy.filesystem.denyWrite
    );
  }

  canDelete(path: string): boolean {
    // Special handling for delete - check both delete and write permissions
    const canDeleteByPolicy = this.checkPath(
      path,
      this.policy.filesystem.allowDelete,
      this.policy.filesystem.denyDelete
    );

    // Also check write permission (delete requires write access to parent dir)
    const canWriteParent = this.canWrite(this.getParentPath(path));

    return canDeleteByPolicy && canWriteParent;
  }

  canExecute(command: string): boolean {
    return this.checkPath(
      command,
      this.policy.filesystem.allowExecute,
      this.policy.filesystem.denyExecute
    );
  }

  // Network checks

  canAccessDomain(domain: string): boolean {
    // Check blocked list first
    if (this.matchesAny(domain, this.policy.network.blockedDomains)) {
      return false;
    }

    // If allowlist is empty, allow all (except blocked)
    if (this.policy.network.allowedDomains.length === 0) {
      return true;
    }

    // Check if domain is in allowlist
    return this.matchesAny(domain, this.policy.network.allowedDomains);
  }

  canAccessIP(ip: string): boolean {
    // Check localhost/loopback
    if (this.isLocalhost(ip) && !this.policy.network.allowLocalhost) {
      return false;
    }
    if (this.isLoopback(ip) && !this.policy.network.allowLoopback) {
      return false;
    }

    // Check blocked IPs
    if (this.matchesAny(ip, this.policy.network.blockedIPs)) {
      return false;
    }

    // If allowlist is empty, allow all (except blocked)
    if (this.policy.network.allowedIPs.length === 0) {
      return true;
    }

    // Check allowlist
    return this.matchesAny(ip, this.policy.network.allowedIPs);
  }

  canAccessPort(port: number): boolean {
    // Check blocked ports
    if (this.policy.network.blockedPorts.includes(port)) {
      return false;
    }

    // If allowlist is empty, allow all (except blocked)
    if (this.policy.network.allowedPorts.length === 0) {
      return true;
    }

    // Check allowlist
    return this.policy.network.allowedPorts.includes(port);
  }

  canUseProtocol(protocol: string): boolean {
    // If allowlist is empty, allow all
    if (this.policy.network.allowedProtocols.length === 0) {
      return true;
    }

    const normalizedProtocol = protocol.toLowerCase().replace(':', '');
    return this.policy.network.allowedProtocols.includes(
      normalizedProtocol as 'http' | 'https' | 'ws' | 'wss' | 'ftp' | 'ssh'
    );
  }

  // Combined network check
  canAccessURL(url: string): {
    allowed: boolean;
    reason?: string;
  } {
    try {
      const parsed = new URL(url);

      // Check protocol
      const protocol = parsed.protocol.replace(':', '');
      if (!this.canUseProtocol(protocol)) {
        return { allowed: false, reason: `Protocol ${protocol} not allowed` };
      }

      // Check domain
      if (!this.canAccessDomain(parsed.hostname)) {
        return { allowed: false, reason: `Domain ${parsed.hostname} not allowed` };
      }

      // Check port
      const port = parsed.port ? parseInt(parsed.port) : (protocol === 'https' ? 443 : 80);
      if (!this.canAccessPort(port)) {
        return { allowed: false, reason: `Port ${port} not allowed` };
      }

      return { allowed: true };
    } catch {
      return { allowed: false, reason: 'Invalid URL' };
    }
  }

  // Helper methods

  private checkPath(path: string, allowList: string[], denyList: string[]): boolean {
    // Expand home directory
    const expandedPath = path.replace(/^~/, process.env.HOME || '');

    // Check deny list first
    if (this.matchesAny(expandedPath, denyList)) {
      return false;
    }

    // If allowlist is empty, allow all (except denied)
    if (allowList.length === 0) {
      return true;
    }

    // Check allowlist
    return this.matchesAny(expandedPath, allowList);
  }

  private matchesAny(str: string, patterns: string[]): boolean {
    return patterns.some(pattern => {
      // Support glob patterns
      if (pattern.includes('*')) {
        return minimatch(str, pattern);
      }
      // Support prefix matching
      if (pattern.endsWith('/')) {
        return str.startsWith(pattern);
      }
      // Exact match or starts with
      return str === pattern || str.startsWith(pattern + '/');
    });
  }

  private getParentPath(path: string): string {
    const parts = path.split('/');
    parts.pop();
    return parts.join('/') || '/';
  }

  private isLocalhost(ip: string): boolean {
    return ip === 'localhost' || ip === '127.0.0.1' || ip === '::1';
  }

  private isLoopback(ip: string): boolean {
    return ip.startsWith('127.') || ip === '::1';
  }

  // Policy introspection

  getPolicy(): Readonly<SandboxPolicy> {
    return Object.freeze(JSON.parse(JSON.stringify(this.policy)));
  }

  describePolicy(): string {
    const lines = ['Sandbox Policy:'];

    lines.push('\nFilesystem:');
    lines.push(`  Read: ${this.policy.filesystem.allowRead.join(', ')}`);
    lines.push(`  Write: ${this.policy.filesystem.allowWrite.join(', ')}`);
    lines.push(`  Delete: ${this.policy.filesystem.allowDelete.join(', ')}`);
    lines.push(`  Denied: ${this.policy.filesystem.denyRead.join(', ')}`);

    lines.push('\nNetwork:');
    lines.push(`  Allowed domains: ${this.policy.network.allowedDomains.join(', ')}`);
    lines.push(`  Blocked ports: ${this.policy.network.blockedPorts.join(', ')}`);
    lines.push(`  Protocols: ${this.policy.network.allowedProtocols.join(', ')}`);
    lines.push(`  Localhost: ${this.policy.network.allowLocalhost ? 'allowed' : 'blocked'}`);

    return lines.join('\n');
  }
}
