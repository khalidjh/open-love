import { Sandbox } from '@e2b/code-interpreter';
import { posix } from 'path';
import { SandboxProvider, SandboxInfo, CommandResult, SandboxFile } from '../types';
// SandboxProviderConfig available through parent class
import { appConfig } from '@/config/app.config';
import { getTemplate } from '@/lib/templates';

export class E2BProvider extends SandboxProvider {
  private existingFiles: Set<string> = new Set();

  private apiKey(): string | undefined {
    return this.config.e2b?.apiKey || process.env.E2B_API_KEY;
  }

  // Confine every filesystem path to /home/user or /tmp. Generated file paths
  // come from model output, so a stray "../../etc/passwd" must resolve-and-reject
  // here rather than land wherever the kernel lets root write. /tmp is allowed
  // because our own deploy/zip flows stage archives there (site.tgz,
  // project.zip) — it's still inside the disposable sandbox VM.
  private resolvePath(path: string): string {
    const base = this.getWorkingDirectory();
    const full = posix.normalize(path.startsWith('/') ? path : posix.join(base, path));
    if (!full.startsWith('/home/user/') && !full.startsWith('/tmp/')) {
      throw new Error(`Refusing to access path outside sandbox home: ${path}`);
    }
    return full;
  }

  /**
   * Re-attach to a still-running E2B sandbox by id. This makes recovery after a
   * server restart nearly free: instead of scaffold + npm install + file replay,
   * we resume the live microVM (files and dev server intact).
   */
  async reconnect(sandboxId: string): Promise<boolean> {
    try {
      const sandbox = await Sandbox.connect(sandboxId, {
        apiKey: this.apiKey(),
        requestTimeoutMs: 15_000,
      });
      const running = await sandbox.isRunning({ requestTimeoutMs: 10_000 }).catch(() => false);
      if (!running) return false;

      this.sandbox = sandbox;
      const host = sandbox.getHost(appConfig.e2b.vitePort);
      this.sandboxInfo = {
        sandboxId,
        url: `https://${host}`,
        provider: 'e2b',
        createdAt: new Date(),
      };
      await this.keepAlive();
      return true;
    } catch {
      // Sandbox was reaped or the id is stale — caller falls back to a rebuild.
      return false;
    }
  }

  async createSandbox(): Promise<SandboxInfo> {
    // Kill existing sandbox if any
    if (this.sandbox) {
      try {
        await this.sandbox.kill();
      } catch (e) {
        console.error('Failed to close existing sandbox:', e);
      }
      this.sandbox = null;
    }

    // Clear existing files tracking
    this.existingFiles.clear();

    // E2B create occasionally fails transiently (capacity, network); one retry
    // with a short backoff absorbs those without hiding real outages.
    const attempts = 2;
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        this.sandbox = await Sandbox.create({
          apiKey: this.apiKey(),
          timeoutMs: this.config.e2b?.timeoutMs || appConfig.e2b.timeoutMs,
          requestTimeoutMs: 120_000 // allow up to 2 min for the sandbox to spin up
        });
        break;
      } catch (error) {
        lastError = error;
        console.error(`[E2BProvider] Error creating sandbox (attempt ${attempt}/${attempts}):`, error);
        if (attempt === attempts) throw error;
        await new Promise((r) => setTimeout(r, 2000 * attempt));
      }
    }
    if (!this.sandbox) throw lastError instanceof Error ? lastError : new Error('Sandbox creation failed');

    const sandboxId = (this.sandbox as any).sandboxId || Date.now().toString();
    const host = (this.sandbox as any).getHost(appConfig.e2b.vitePort);

    this.sandboxInfo = {
      sandboxId,
      url: `https://${host}`,
      provider: 'e2b',
      createdAt: new Date()
    };

    // Set extended timeout on the sandbox instance if method available
    // (awaited — see keepAlive for why floating this promise is dangerous).
    if (typeof this.sandbox.setTimeout === 'function') {
      await this.sandbox.setTimeout(appConfig.e2b.timeoutMs).catch((e: unknown) => {
        console.error('[E2BProvider] initial setTimeout failed:', e);
      });
    }

    return this.sandboxInfo;
  }

  // Real liveness probe: the E2B microVM can be reaped once its TTL elapses, at
  // which point the cached sandboxId/URL are dead. isRunning() is a single cheap
  // control-plane call — unlike spinning up the Python interpreter to print pong.
  async ping(): Promise<boolean> {
    if (!this.sandbox) return false;
    try {
      return await this.sandbox.isRunning({ requestTimeoutMs: 10_000 });
    } catch {
      return false;
    }
  }

  // Extend the sandbox's TTL so an active editing session isn't reaped mid-use.
  // MUST await the SDK call: un-awaited, a dead sandbox turns this into an
  // unhandled promise rejection that can take down the whole Node process.
  async keepAlive(): Promise<void> {
    if (!this.sandbox) return;
    try {
      if (typeof this.sandbox.setTimeout === 'function') {
        await this.sandbox.setTimeout(appConfig.e2b.timeoutMs);
      }
    } catch (e) {
      console.error('[E2BProvider] keepAlive failed:', e);
    }
  }

  async runCommand(command: string): Promise<CommandResult> {
    if (!this.sandbox) {
      throw new Error('No active sandbox');
    }


    // shlex.split honors quoting ("npm pkg set description='two words'"),
    // unlike naive whitespace splitting which mangles any quoted argument.
    const result = await this.sandbox.runCode(`
      import subprocess
      import os
      import shlex

      os.chdir('/home/user/app')
      result = subprocess.run(shlex.split(${JSON.stringify(command)}),
                            capture_output=True,
                            text=True,
                            shell=False)

      print("STDOUT:")
      print(result.stdout)
      if result.stderr:
          print("\\nSTDERR:")
          print(result.stderr)
      print(f"\\nReturn code: {result.returncode}")
    `);
    
    const output = result.logs.stdout.join('\n');
    const stderr = result.logs.stderr.join('\n');
    
    return {
      stdout: output,
      stderr,
      exitCode: result.error ? 1 : 0,
      success: !result.error
    };
  }

  getWorkingDirectory(): string {
    return appConfig.e2b.workingDirectory; // /home/user/app
  }

  async runShell(command: string): Promise<CommandResult> {
    if (!this.sandbox) {
      throw new Error('No active sandbox');
    }

    // Run via the code interpreter (runs as root, like the rest of this provider)
    // with a real shell so `&&`, `cd`, redirects, etc. all work. Using
    // commands.run here fails because it executes as the `user` account, which
    // cannot write into the root-owned app directory (EACCES during builds).
    const cwd = this.getWorkingDirectory();
    // 5-min ceiling instead of runCode's 60s default: deploy builds
    // (npm run build) and installs routinely outlive a minute.
    const result = await this.sandbox.runCode(`
import subprocess, sys
r = subprocess.run(${JSON.stringify(command)}, shell=True, cwd=${JSON.stringify(cwd)},
                   capture_output=True, text=True)
sys.stdout.write(r.stdout)
sys.stderr.write(r.stderr)
sys.stdout.write("\\n__RC__=%d__" % r.returncode)
`, { timeoutMs: 300_000 });

    let stdout = (result.logs?.stdout || []).join('');
    const stderr = (result.logs?.stderr || []).join('');
    const rcMatch = stdout.match(/__RC__=(\d+)__\s*$/);
    const exitCode = rcMatch ? parseInt(rcMatch[1], 10) : (result.error ? 1 : 0);
    stdout = stdout.replace(/\n?__RC__=\d+__\s*$/, '');

    return {
      stdout,
      stderr: stderr || (result.error ? String(result.error) : ''),
      exitCode,
      success: exitCode === 0
    };
  }

  async readBinaryFileBase64(path: string): Promise<string> {
    if (!this.sandbox) {
      throw new Error('No active sandbox');
    }

    const data = await (this.sandbox as any).files.read(this.resolvePath(path), { format: 'bytes' });
    return Buffer.from(data).toString('base64');
  }

  async writeFile(path: string, content: string): Promise<void> {
    if (!this.sandbox) {
      throw new Error('No active sandbox');
    }

    await (this.sandbox as any).files.write(this.resolvePath(path), Buffer.from(content));
    this.existingFiles.add(path);
  }

  // Batch write via the SDK's multi-entry files.write — one round-trip for the
  // whole set instead of one per file. Used for replaying a project on recovery.
  async writeFiles(files: SandboxFile[]): Promise<void> {
    if (!this.sandbox) {
      throw new Error('No active sandbox');
    }
    if (files.length === 0) return;

    const entries = files.map((f) => ({ path: this.resolvePath(f.path), data: f.content }));
    await (this.sandbox as any).files.write(entries);
    for (const f of files) this.existingFiles.add(f.path);
  }

  async readFile(path: string): Promise<string> {
    if (!this.sandbox) {
      throw new Error('No active sandbox');
    }

    // files.read returns the exact content; the old print()-based round-trip
    // corrupted files (interpolated the path into Python source, and stdout
    // joining rewrote newlines).
    return await (this.sandbox as any).files.read(this.resolvePath(path));
  }

  async listFiles(directory: string = '/home/user/app'): Promise<string[]> {
    if (!this.sandbox) {
      throw new Error('No active sandbox');
    }

    const result = await this.sandbox.runCode(`
      import os
      import json

      def list_files(path):
          files = []
          for root, dirs, filenames in os.walk(path):
              # Skip node_modules and .git
              dirs[:] = [d for d in dirs if d not in ['node_modules', '.git', '.next', 'dist', 'build']]
              for filename in filenames:
                  rel_path = os.path.relpath(os.path.join(root, filename), path)
                  files.append(rel_path)
          return files

      files = list_files(${JSON.stringify(this.resolvePath(directory))})
      print(json.dumps(files))
    `);

    try {
      return JSON.parse(result.logs.stdout.join(''));
    } catch {
      return [];
    }
  }

  async installPackages(packages: string[]): Promise<CommandResult> {
    if (!this.sandbox) {
      throw new Error('No active sandbox');
    }

    const packageList = packages.join(' ');
    const flags = appConfig.packages.useLegacyPeerDeps ? '--legacy-peer-deps' : '';
    
    
    const result = await this.sandbox.runCode(`
      import subprocess
      import os

      os.chdir('/home/user/app')

      # Install packages
      result = subprocess.run(
          ['npm', 'install', ${flags ? `'${flags}',` : ''} ${packages.map(p => `'${p}'`).join(', ')}],
          capture_output=True,
          text=True
      )

      print("STDOUT:")
      print(result.stdout)
      if result.stderr:
          print("\\nSTDERR:")
          print(result.stderr)
      print(f"\\nReturn code: {result.returncode}")
    `);
    
    const output = result.logs.stdout.join('\n');
    const stderr = result.logs.stderr.join('\n');
    
    // Restart Vite if configured
    if (appConfig.packages.autoRestartVite && !result.error) {
      await this.restartViteServer();
    }
    
    return {
      stdout: output,
      stderr,
      exitCode: result.error ? 1 : 0,
      success: !result.error
    };
  }

  async setupViteApp(): Promise<void> {
    if (!this.sandbox) {
      throw new Error('No active sandbox');
    }

    
    // Write all files in a single Python script
    const setupScript = `
import os
import json

print('Setting up React app with Vite and Tailwind...')

# Create directory structure
os.makedirs('/home/user/app/src', exist_ok=True)

# Package.json
package_json = {
    "name": "sandbox-app",
    "version": "1.0.0",
    "type": "module",
    "scripts": {
        "dev": "vite --host",
        "build": "vite build",
        "preview": "vite preview"
    },
    "dependencies": {
        "react": "^18.2.0",
        "react-dom": "^18.2.0"
    },
    "devDependencies": {
        "@vitejs/plugin-react": "^4.0.0",
        "vite": "^4.3.9",
        "tailwindcss": "^3.3.0",
        "postcss": "^8.4.31",
        "autoprefixer": "^10.4.16"
    }
}

with open('/home/user/app/package.json', 'w') as f:
    json.dump(package_json, f, indent=2)
print('✓ package.json')

# Vite config
vite_config = """import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    hmr: false,
    allowedHosts: ['.e2b.app', '.e2b.dev', '.vercel.run', 'localhost', '127.0.0.1']
  }
})"""

with open('/home/user/app/vite.config.js', 'w') as f:
    f.write(vite_config)
print('✓ vite.config.js')

# Tailwind config
tailwind_config = """/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}"""

with open('/home/user/app/tailwind.config.js', 'w') as f:
    f.write(tailwind_config)
print('✓ tailwind.config.js')

# PostCSS config
postcss_config = """export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}"""

with open('/home/user/app/postcss.config.js', 'w') as f:
    f.write(postcss_config)
print('✓ postcss.config.js')

# Index.html
index_html = """<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Sandbox App</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>"""

with open('/home/user/app/index.html', 'w') as f:
    f.write(index_html)
print('✓ index.html')

# Main.jsx
main_jsx = """import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)"""

with open('/home/user/app/src/main.jsx', 'w') as f:
    f.write(main_jsx)
print('✓ src/main.jsx')

# App.jsx
app_jsx = """function App() {
  return (
    <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center p-4">
      <div className="text-center max-w-2xl">
        <p className="text-lg text-gray-400">
          Sandbox Ready<br/>
          Start building your React app with Vite and Tailwind CSS!
        </p>
      </div>
    </div>
  )
}

export default App"""

with open('/home/user/app/src/App.jsx', 'w') as f:
    f.write(app_jsx)
print('✓ src/App.jsx')

# Index.css
index_css = """@tailwind base;
@tailwind components;
@tailwind utilities;

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
  background-color: rgb(17 24 39);
}"""

with open('/home/user/app/src/index.css', 'w') as f:
    f.write(index_css)
print('✓ src/index.css')

print('\\nAll files created successfully!')
`;

    await this.sandbox.runCode(setupScript);
    
    // Install dependencies
    await this.sandbox.runCode(`
import subprocess

print('Installing npm packages...')
result = subprocess.run(
    ['npm', 'install'],
    cwd='/home/user/app',
    capture_output=True,
    text=True
)

if result.returncode == 0:
    print('✓ Dependencies installed successfully')
else:
    print(f'⚠ Warning: npm install had issues: {result.stderr}')
    `);
    
    // Start Vite dev server
    await this.sandbox.runCode(`
import subprocess
import os
import time

os.chdir('/home/user/app')

# Kill any existing Vite processes
subprocess.run(['pkill', '-f', 'vite'], capture_output=True)
time.sleep(1)

# Start Vite dev server
env = os.environ.copy()
env['FORCE_COLOR'] = '0'

process = subprocess.Popen(
    ['npm', 'run', 'dev'],
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE,
    env=env
)

print(f'✓ Vite dev server started with PID: {process.pid}')
print('Waiting for server to be ready...')
    `);

    // Wait for Vite to actually accept connections instead of sleeping blindly.
    await this.waitForServerReady(appConfig.e2b.viteStartupDelay * 3);

    // Track initial files
    this.existingFiles.add('src/App.jsx');
    this.existingFiles.add('src/main.jsx');
    this.existingFiles.add('src/index.css');
    this.existingFiles.add('index.html');
    this.existingFiles.add('package.json');
    this.existingFiles.add('vite.config.js');
    this.existingFiles.add('tailwind.config.js');
    this.existingFiles.add('postcss.config.js');
  }

  // Scaffold a full-stack Next.js (App Router) app instead of the Vite SPA.
  // Runs Next on the same port the sandbox already proxies (5173) so the
  // existing preview-URL plumbing is unchanged.
  async setupNextApp(): Promise<void> {
    if (!this.sandbox) {
      throw new Error('No active sandbox');
    }

    const tpl = getTemplate('nextjs');

    // Ensure nested dirs (app/) exist, then write every scaffold file.
    await this.runShell('mkdir -p app');
    for (const f of tpl.scaffoldFiles) {
      await this.writeFile(f.path, f.content);
    }

    // Install dependencies.
    const legacy = appConfig.packages.useLegacyPeerDeps ? '--legacy-peer-deps' : '';
    await this.runShell(`npm install ${legacy}`.trim());

    // Start the Next dev server (non-blocking Popen, like the Vite setup).
    await this.startNextServer();

    for (const f of tpl.scaffoldFiles) this.existingFiles.add(f.path);
  }

  // Poll the dev-server port inside the sandbox until it accepts a connection,
  // up to maxWaitMs. Returns as soon as the server is up (typically seconds),
  // where the old fixed sleeps always paid the full 10–20s and still couldn't
  // tell whether the server had actually started.
  private async waitForServerReady(maxWaitMs: number): Promise<boolean> {
    if (!this.sandbox) return false;
    try {
      const result = await this.sandbox.runCode(`
import socket, time
deadline = time.time() + ${Math.ceil(maxWaitMs / 1000)}
ready = False
while time.time() < deadline and not ready:
    s = socket.socket()
    s.settimeout(1)
    try:
        s.connect(('127.0.0.1', ${appConfig.e2b.vitePort}))
        ready = True
    except Exception:
        time.sleep(0.5)
    s.close()
print('READY' if ready else 'TIMEOUT')
`);
      const ready = (result.logs?.stdout || []).join('').includes('READY');
      if (!ready) console.error('[E2BProvider] dev server did not become ready within', maxWaitMs, 'ms');
      return ready;
    } catch (e) {
      console.error('[E2BProvider] readiness probe failed:', e);
      return false;
    }
  }

  private async startNextServer(): Promise<void> {
    if (!this.sandbox) throw new Error('No active sandbox');
    await this.sandbox.runCode(`
import subprocess
import os
import time

os.chdir('/home/user/app')

# Kill any existing Next process
subprocess.run(['pkill', '-f', 'next'], capture_output=True)
time.sleep(1)

env = os.environ.copy()
env['FORCE_COLOR'] = '0'
env['PORT'] = '${appConfig.e2b.vitePort}'  # bind to the proxied port

process = subprocess.Popen(
    ['npm', 'run', 'dev'],
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE,
    env=env
)
print(f'✓ Next dev server started with PID: {process.pid}')
    `);
    await this.waitForServerReady(appConfig.e2b.nextStartupDelay * 3);
  }

  async restartNextServer(): Promise<void> {
    if (!this.sandbox) {
      throw new Error('No active sandbox');
    }
    await this.startNextServer();
  }

  async restartViteServer(): Promise<void> {
    if (!this.sandbox) {
      throw new Error('No active sandbox');
    }


    await this.sandbox.runCode(`
import subprocess
import time
import os

os.chdir('/home/user/app')

# Kill existing Vite process
subprocess.run(['pkill', '-f', 'vite'], capture_output=True)
time.sleep(2)

# Start Vite dev server
env = os.environ.copy()
env['FORCE_COLOR'] = '0'

process = subprocess.Popen(
    ['npm', 'run', 'dev'],
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE,
    env=env
)

print(f'✓ Vite restarted with PID: {process.pid}')
    `);

    // Wait for Vite to actually accept connections instead of sleeping blindly.
    await this.waitForServerReady(appConfig.e2b.viteStartupDelay * 3);
  }

  getSandboxUrl(): string | null {
    return this.sandboxInfo?.url || null;
  }

  getSandboxInfo(): SandboxInfo | null {
    return this.sandboxInfo;
  }

  async terminate(): Promise<void> {
    if (this.sandbox) {
      try {
        await this.sandbox.kill();
      } catch (e) {
        console.error('Failed to terminate sandbox:', e);
      }
      this.sandbox = null;
      this.sandboxInfo = null;
    }
  }

  isAlive(): boolean {
    return !!this.sandbox;
  }
}