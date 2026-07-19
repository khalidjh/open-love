import type { SandboxProvider } from '@/lib/sandbox/types';
import type { Framework } from '@/lib/templates';

export interface BuildError {
  file?: string;
  message: string;
}

const SRC_RE = /\.(jsx?|tsx?)$/;
const SAFE_PATH = /^[\w./@-]+$/; // reject anything with shell metacharacters
const MAX_FILES = 15;

// Detect compile/syntax errors in a freshly-applied build, server-side, so the
// job runner can auto-fix them. Best-effort: ANY failure returns [] — this must
// never block an otherwise-successful build.
//
// Two strategies, because the frameworks fail differently:
//   • Vite compiles lazily and shows errors via a client-side HMR overlay, so a
//     server fetch can't see them. Instead we esbuild-parse the changed files.
//     No bundling → aliases/CSS/plugins don't cause false positives; this nails
//     SYNTAX errors, the most common thing a model gets wrong. (Missing-package
//     imports are handled separately by the install loop.)
//   • Next prints compile errors to its dev server output, which we capture to
//     /tmp/next.log and read here.
export async function detectBuildErrors(
  provider: SandboxProvider,
  framework: Framework,
  changedFiles: string[],
): Promise<BuildError[]> {
  try {
    return framework === 'nextjs'
      ? await detectNextErrors(provider)
      : await detectViteErrors(provider, changedFiles);
  } catch (e) {
    console.error('[build-check] detection failed (ignored):', e);
    return [];
  }
}

async function detectViteErrors(
  provider: SandboxProvider,
  changedFiles: string[],
): Promise<BuildError[]> {
  const files = changedFiles.filter((f) => SRC_RE.test(f) && SAFE_PATH.test(f)).slice(0, MAX_FILES);
  if (files.length === 0) return [];

  const cwd = provider.getWorkingDirectory();
  const checks = files
    .map((f) => {
      // Parse only (no --bundle): pure syntax validation, no module resolution, so
      // aliases/CSS/plugins can't cause false positives. esbuild infers the loader
      // from the extension (.jsx/.ts/.tsx); we only override .js so JSX-in-.js parses.
      return (
        `E=$("$ESB" ${JSON.stringify(f)} --loader:.js=jsx --log-level=error --outfile=/dev/null 2>&1); ` +
        `if [ -n "$E" ]; then printf '<<<FILE:%s>>>\\n%s\\n' ${JSON.stringify(f)} "$E"; fi`
      );
    })
    .join('\n');

  const cmd =
    `cd ${JSON.stringify(cwd)} && ` +
    `ESB=./node_modules/.bin/esbuild; [ -x "$ESB" ] || ESB="npx --no-install esbuild"; ` +
    `${checks}`;

  const res = await provider.runShell(cmd);
  return parseEsbuildBlocks(res.stdout || '');
}

function parseEsbuildBlocks(stdout: string): BuildError[] {
  const out: BuildError[] = [];
  for (const part of stdout.split('<<<FILE:')) {
    const m = part.match(/^([^\n>]+)>>>\n([\s\S]*)$/);
    if (!m) continue;
    const file = m[1].trim();
    const message = m[2].trim().slice(0, 800);
    if (message) out.push({ file, message });
  }
  return out;
}

const NEXT_SIGNATURES = [
  'Failed to compile',
  'Module not found',
  'SyntaxError',
  'Unexpected token',
  'Unexpected eof',
  'Expression expected',
  "Can't resolve",
];

async function detectNextErrors(provider: SandboxProvider): Promise<BuildError[]> {
  const res = await provider.runShell(`tail -c 8000 /tmp/next.log 2>/dev/null || true`);
  const log = res.stdout || '';
  if (!NEXT_SIGNATURES.some((s) => log.includes(s))) return [];
  // Return a window around the first error marker as the message for the fixer.
  const idx = Math.max(0, log.search(/Failed to compile|Module not found|SyntaxError|Error:/i));
  const message = log.slice(Math.max(0, idx - 200), idx + 1400).trim();
  return message ? [{ message }] : [];
}
