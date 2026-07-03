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