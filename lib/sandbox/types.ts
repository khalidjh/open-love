export interface SandboxFile {
  path: string;
  content: string;
  lastModified?: number;
}

export interface SandboxInfo {
  sandboxId: string;
  url: string;
  provider: 'e2b' | 'vercel';
  createdAt: Date;
}

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  success: boolean;
}

export interface SandboxProviderConfig {
  e2b?: {
    apiKey: string;
    timeoutMs?: number;
    template?: string;
  };
  vercel?: {
    teamId?: string;
    projectId?: string;
    token?: string;
    authMethod?: 'oidc' | 'pat';
  };
}

export abstract class SandboxProvider {
  protected config: SandboxProviderConfig;
  protected sandbox: any;
  protected sandboxInfo: SandboxInfo | null = null;

  constructor(config: SandboxProviderConfig) {
    this.config = config;
  }

  abstract createSandbox(): Promise<SandboxInfo>;
  abstract runCommand(command: string): Promise<CommandResult>;
  abstract writeFile(path: string, content: string): Promise<void>;
  abstract readFile(path: string): Promise<string>;
  abstract listFiles(directory?: string): Promise<string[]>;
  abstract installPackages(packages: string[]): Promise<CommandResult>;
  abstract getSandboxUrl(): string | null;
  abstract getSandboxInfo(): SandboxInfo | null;
  abstract terminate(): Promise<void>;
  abstract isAlive(): boolean;

  // Verify the sandbox is genuinely reachable via a real round-trip, rather than
  // trusting cached in-memory state like isAlive(). Providers whose underlying
  // sandbox can be reaped out from under us (e.g. E2B's TTL) should override this
  // with an actual liveness probe. Default falls back to the in-memory flag.
  async ping(): Promise<boolean> {
    return this.isAlive();
  }

  // Re-attach to a still-running sandbox by id (e.g. after the Node process
  // restarted but the sandbox survived). Returns false when the provider can't
  // reconnect or the sandbox is gone — callers then fall back to a full rebuild.
  async reconnect(_sandboxId: string): Promise<boolean> {
    return false;
  }

  // Write many files in one call. Providers with a batch filesystem API should
  // override this; the default degrades to sequential single writes.
  async writeFiles(files: SandboxFile[]): Promise<void> {
    for (const f of files) {
      await this.writeFile(f.path, f.content);
    }
  }

  // Refresh the sandbox's TTL so an active session isn't reaped mid-use. No-op by
  // default; providers with an idle timeout should override.
  async keepAlive(): Promise<void> {
    // no-op
  }

  // Working directory of the generated app inside the sandbox
  abstract getWorkingDirectory(): string;

  // Run a raw shell command (proper bash, not naive space-splitting like runCommand)
  async runShell(_command: string): Promise<CommandResult> {
    throw new Error('runShell not implemented for this provider');
  }

  // Read a binary file from the sandbox and return it base64-encoded
  async readBinaryFileBase64(_path: string): Promise<string> {
    throw new Error('readBinaryFileBase64 not implemented for this provider');
  }

  // Optional methods that providers can override
  async setupViteApp(): Promise<void> {
    // Default implementation for setting up a Vite React app
    throw new Error('setupViteApp not implemented for this provider');
  }
  
  async restartViteServer(): Promise<void> {
    // Default implementation for restarting Vite
    throw new Error('restartViteServer not implemented for this provider');
  }

  // Full-stack Next.js (App Router) equivalents — implemented by providers that
  // support the Next.js template.
  async setupNextApp(): Promise<void> {
    throw new Error('setupNextApp not implemented for this provider');
  }

  async restartNextServer(): Promise<void> {
    throw new Error('restartNextServer not implemented for this provider');
  }
}