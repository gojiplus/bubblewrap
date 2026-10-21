# Security Guide

## Security Features

### Filesystem Isolation

Linux uses bubblewrap filesystem namespaces. macOS uses a default-deny Seatbelt profile with Apple runtime rules and configured filesystem access. Commands fail when the OS sandbox is unavailable, including in CI.

Filesystem controls include:

- **Read-only system directories**: `/usr`, `/lib`, `/bin` mounted as read-only
- **Working directory only**: Write access restricted to project directory
- **Blocked sensitive paths**:
  - `~/.ssh` - SSH keys
  - `~/.aws` - AWS credentials
  - `~/.config/gcloud` - Google Cloud credentials
  - `~/.gnupg` - GPG keys
  - `~/.kube` - Kubernetes config
  - `~/.docker` - Docker credentials
  - `/etc/passwd`, `/etc/shadow` - System authentication

### Network Control

The optional proxy filters requests from clients that use its proxy settings. It does not enforce network isolation: Linux shares the host network namespace, and the macOS profile allows network access. A command can bypass the proxy by opening a direct connection. Use an external firewall or an isolated virtual machine when network containment is required.

### Permission System

Every sensitive operation requires approval:

- **Granular permissions**: Separate permissions for read, write, network, execute
- **Time-limited**: Permissions expire after 1 hour (configurable)
- **Revocable**: Users can revoke permissions at any time
- **Auto-approval**: Safe operations can be pre-approved

## Threat Model

### Protected Against

✓ **Credential Theft**
```bash
# This will FAIL - access denied
cat ~/.ssh/id_rsa
```

✓ **Unauthorized File Access**
```bash
# This will FAIL - outside working directory
rm -rf /etc
```

### NOT Protected Against

✗ **Direct network access and exfiltration**
- Proxy settings are advisory and can be bypassed by commands.
- Files readable inside the sandbox can be sent over the network.

✗ **Resource Exhaustion**
- CPU intensive tasks
- Memory bombs
- Disk space filling (within working directory)
- Solution: Implement resource limits (future enhancement)

✗ **Time-of-check/Time-of-use Attacks**
- Symlink attacks within working directory
- Solution: Careful path validation

✗ **Side Channels**
- Timing attacks
- Spectre/Meltdown
- Solution: Run in isolated VM for sensitive work

✗ **Kernel Exploits**
- Privilege escalation via kernel bugs
- Solution: Keep kernel updated, use security modules (SELinux, AppArmor)

## Security Best Practices

### For Users

1. **Review Permissions**: Always review what the agent is requesting
2. **Limit Scope**: Only approve the minimum necessary permissions
3. **Check Domains**: Verify network requests are to legitimate domains
4. **Monitor Logs**: Review command execution logs regularly
5. **Use Non-Interactive Mode**: More secure than interactive mode

### For Developers

1. **Validate Inputs**: Never trust user input in command construction
2. **Use Allowlists**: Prefer allowlists over blocklists
3. **Fail Secure**: Deny by default, allow explicitly
4. **Log Everything**: Comprehensive logging for security audit
5. **Update Dependencies**: Keep sandbox and dependencies updated

## Configuration Hardening

### Minimal Permissions

```typescript
const sandbox = new SandboxManager(process.cwd(), {
  // Only allow specific domains
  allowedDomains: ['github.com', 'api.openai.com'],

  // Block everything else
  requireApprovalForNewDomains: true,

  // Minimal filesystem access
  allowedReadPaths: ['/usr', '/lib', process.cwd()],
  allowedWritePaths: [process.cwd()],

  // Explicit deny list
  deniedPaths: [
    '~/.ssh',
    '~/.aws',
    '~/.config',
    '~/.gnupg',
  ],
});

// No auto-approval - user must approve everything
// sandbox.setAutoApprove([]);
```

### Moderate Security

```typescript
const sandbox = new SandboxManager(process.cwd(), {
  allowedDomains: [
    'github.com',
    '*.githubusercontent.com',
    'npmjs.com',
    'pypi.org',
  ],
  requireApprovalForNewDomains: true,
});

// Auto-approve safe reads
sandbox.setAutoApprove([PermissionType.FILESYSTEM_READ]);
```

### Development Mode (Less Secure)

```typescript
const sandbox = new SandboxManager(process.cwd(), {
  allowedDomains: ['*'], // Allow all domains
  requireApprovalForNewDomains: false,
});

// Auto-approve most operations
sandbox.setAutoApprove([
  PermissionType.FILESYSTEM_READ,
  PermissionType.FILESYSTEM_WRITE,
  PermissionType.PROCESS_SPAWN,
]);
```

## Incident Response

### If Credentials Are Exposed

1. **Immediately revoke** exposed credentials
2. **Check logs** for unauthorized access
3. **Rotate all keys** that may have been exposed
4. **Report** to security team

### If Malicious Code Executed

1. **Stop the sandbox** immediately
2. **Review logs** to understand what was executed
3. **Scan working directory** for malicious files
4. **Check network logs** for data exfiltration
5. **Restore from backup** if necessary

### If System Compromised

1. **Isolate the machine** from network
2. **Preserve evidence** (logs, memory dump)
3. **Notify security team**
4. **Investigate root cause**
5. **Reinstall if necessary**

## Security Testing

### Running Security Tests

```bash
npm test

# Expected results:
# ✓ Blocks access to SSH keys
# ✓ Blocks access to AWS credentials
# ✓ Blocks access to GCloud credentials
# ✓ Blocks access to /etc/passwd
# ✓ Allows access to working directory
# ✓ Network routes through proxy
```

### Manual Security Testing

```bash
# Test 1: Try to access SSH keys
npm run sandbox -- exec cat ~/.ssh/id_rsa
# Expected: Permission denied

# Test 2: Try to write outside working directory
npm run sandbox -- exec touch /etc/malicious
# Expected: Permission denied

# Test 3: Try to access AWS credentials
npm run sandbox -- exec cat ~/.aws/credentials
# Expected: Permission denied

# Test 4: Test network filtering
npm run sandbox -- exec curl https://suspicious-domain.com
# Expected: Blocked or requires approval
```

## Reporting Security Issues

If you discover a security vulnerability:

1. **DO NOT** open a public issue
2. **Email** security@example.com with:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)
3. **Wait** for response before disclosure
4. **Coordinate** disclosure timeline

We aim to respond within 48 hours and fix critical issues within 7 days.

## Security Roadmap

### Q1 2024
- [ ] Resource limits (CPU, memory, disk)
- [ ] Advanced network protocol support
- [ ] Security audit by external firm

### Q2 2024
- [ ] macOS support with sandbox-exec
- [ ] Windows support via WSL2
- [ ] Policy engine for auto-approval rules

### Q3 2024
- [ ] Real-time monitoring dashboard
- [ ] Anomaly detection
- [ ] Integration with SIEM systems

### Q4 2024
- [ ] eBPF-based filtering for zero overhead
- [ ] Hardware isolation options (SGX)
- [ ] Distributed sandboxing

## References

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [CWE Top 25](https://cwe.mitre.org/top25/)
- [Linux Namespace Security](https://man7.org/linux/man-pages/man7/namespaces.7.html)
- [Bubblewrap Security Model](https://github.com/containers/bubblewrap)

## Acknowledgments

Security researchers who have contributed:
- (None yet - be the first!)

## License

This security documentation is licensed under CC BY-SA 4.0.
