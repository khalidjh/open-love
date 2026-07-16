// Decide how a generated app should be deployed, from its source alone — the
// user never picks. Next.js (or any server signal) → full-stack on Vercel;
// otherwise a static SPA (Vite) → Netlify.

export type DeployTarget = 'static' | 'fullstack';

// Dirs that never belong in a source scan (deps, build output, VCS).
const SKIP = /(^|\/)(node_modules|dist|\.next|\.git|\.vercel|build)\//;

export function detectDeployTarget(files: Record<string, string>): DeployTarget {
  // 1. Dependencies are the strongest signal: next → full-stack; vite without
  //    next → static, decisively — don't let a stray "use server" mention in a
  //    comment or string (checked below) misroute a Vite SPA into a Next build
  //    that can only fail.
  const pkg = files['package.json'];
  if (pkg) {
    try {
      const json = JSON.parse(pkg);
      const deps = { ...json.dependencies, ...json.devDependencies };
      if (deps.next) return 'fullstack';
      if (deps.vite) return 'static';
    } catch {
      // malformed package.json — fall through to file-based checks
    }
  }

  const paths = Object.keys(files);

  // 2. A Next config file.
  if (paths.some((p) => /^next\.config\.(js|ts|mjs|cjs)$/.test(p))) return 'fullstack';

  // 3. Server-side surface: API routes anywhere Next expects them.
  if (paths.some((p) => /(^|\/)(app|pages)\/api\//.test(p) || /(^|\/)src\/(app|pages)\/api\//.test(p))) {
    return 'fullstack';
  }

  // 4. Server actions / SSR data hooks in the code itself.
  if (Object.values(files).some((c) => /['"]use server['"]/.test(c) || /getServerSideProps|getStaticProps/.test(c))) {
    return 'fullstack';
  }

  return 'static';
}

// Read the generated app's source out of the live sandbox as { path: content }.
// Skips dependency/build/VCS dirs. Used for both detection and the Vercel upload.
export async function collectSandboxSource(provider: any): Promise<Record<string, string>> {
  const paths: string[] = await provider.listFiles();
  const files: Record<string, string> = {};
  for (const raw of paths) {
    const path = raw.replace(/^\.?\//, '');
    if (!path || SKIP.test(`/${path}`)) continue;
    // A listed file that can't be read means an INCOMPLETE upload — publishing
    // it produces a build that can't compile (or a site missing code). Retry
    // once for transient sandbox hiccups, then abort the deploy loudly.
    let content: unknown;
    try {
      content = await provider.readFile(path);
    } catch {
      try {
        content = await provider.readFile(path);
      } catch {
        throw new Error(`Could not read ${path} from the sandbox. Try publishing again.`);
      }
    }
    if (typeof content === 'string') files[path] = content;
  }
  return files;
}
