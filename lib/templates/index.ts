// =============================================================================
// Generation templates.
//
// A generated app is scaffolded from one of two templates. The choice is made
// once, at project creation, by auto-detecting whether the user's request needs
// a backend — the user never picks (see detectFramework).
//
//   • 'vite'   — static React SPA. Deploys static (Netlify). Default.
//   • 'nextjs' — full-stack App Router app. Deploys to Vercel with SSR + API
//                routes. Chosen when the app needs auth / a database / server
//                logic.
//
// Everything that differs between the two frameworks is centralized here so the
// providers, the apply pipeline, the env writers, and the AI prompt can stay
// framework-agnostic and just consult a descriptor.
// =============================================================================

export type Framework = 'vite' | 'nextjs';

export interface ScaffoldFile {
  path: string;    // relative to the sandbox working directory
  content: string;
}

export interface Template {
  framework: Framework;

  // How injected credentials are named + read (VITE_* via import.meta.env for
  // Vite; NEXT_PUBLIC_* via process.env for Next).
  env: {
    supabaseUrl: string;
    supabaseAnonKey: string;
    supabaseSchema: string;
    authIssuer: string;
    authClientId: string;
    // Server-only AI proxy vars (NO public prefix — must never reach the browser;
    // only read inside a server route). Same names on both frameworks.
    aiProxyUrl: string;
    aiProxyKey: string;
    // Server-only speech-to-text endpoint (authed with aiProxyKey). Same name on both.
    transcribeUrl: string;
    // How the generated app reads a public var, e.g. `import.meta.env.X` — used
    // only to phrase the prompt.
    read: (name: string) => string;
  };

  // Files the apply pipeline must treat as root config (never move under src/).
  configFiles: string[];
  // Whether loose files should be force-prefixed with `src/` (Vite convention).
  applySrcPrefix: boolean;
  // Candidate entry points, for manifest detection.
  entryPoints: string[];

  // Dev-server details for the sandbox.
  dev: {
    processName: string;   // for `pkill -f <name>`
    startupDelayMs: number;
  };

  // Files written at scaffold time. Empty for Vite — the providers keep their
  // existing inline Vite scaffold; only Next.js is scaffolded from this list.
  scaffoldFiles: ScaffoldFile[];

  // Framework-specific guidance appended to the generation system prompt.
  promptGuidance: string;
}

// -----------------------------------------------------------------------------
// Vite descriptor (metadata only — providers own the inline Vite scaffold).
// -----------------------------------------------------------------------------
const VITE: Template = {
  framework: 'vite',
  env: {
    supabaseUrl: 'VITE_SUPABASE_URL',
    supabaseAnonKey: 'VITE_SUPABASE_ANON_KEY',
    supabaseSchema: 'VITE_SUPABASE_SCHEMA',
    authIssuer: 'VITE_AUTH_ISSUER',
    authClientId: 'VITE_AUTH_CLIENT_ID',
    aiProxyUrl: 'ETLAQ_AI_URL',
    aiProxyKey: 'ETLAQ_AI_KEY',
    transcribeUrl: 'ETLAQ_TRANSCRIBE_URL',
    read: (name) => `import.meta.env.${name}`,
  },
  configFiles: ['tailwind.config.js', 'vite.config.js', 'package.json', 'package-lock.json', 'tsconfig.json', 'postcss.config.js'],
  applySrcPrefix: true,
  entryPoints: ['src/main.jsx', 'src/index.jsx', 'src/App.jsx'],
  dev: { processName: 'vite', startupDelayMs: 10000 },
  scaffoldFiles: [],
  promptGuidance: '', // the base prompt is already Vite-oriented
};

// -----------------------------------------------------------------------------
// Next.js descriptor (App Router, JavaScript/JSX, Tailwind).
// -----------------------------------------------------------------------------
const NEXTJS: Template = {
  framework: 'nextjs',
  env: {
    supabaseUrl: 'NEXT_PUBLIC_SUPABASE_URL',
    supabaseAnonKey: 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    supabaseSchema: 'NEXT_PUBLIC_SUPABASE_SCHEMA',
    authIssuer: 'NEXT_PUBLIC_AUTH_ISSUER',
    authClientId: 'NEXT_PUBLIC_AUTH_CLIENT_ID',
    aiProxyUrl: 'ETLAQ_AI_URL',
    aiProxyKey: 'ETLAQ_AI_KEY',
    transcribeUrl: 'ETLAQ_TRANSCRIBE_URL',
    read: (name) => `process.env.${name}`,
  },
  configFiles: ['tailwind.config.js', 'next.config.mjs', 'package.json', 'package-lock.json', 'jsconfig.json', 'postcss.config.js'],
  applySrcPrefix: false, // App Router paths (app/page.jsx) must be preserved as-is
  entryPoints: ['app/page.jsx', 'app/page.tsx', 'app/layout.jsx'],
  dev: { processName: 'next', startupDelayMs: 20000 },
  scaffoldFiles: [
    {
      path: 'package.json',
      content: JSON.stringify(
        {
          name: 'sandbox-app',
          version: '1.0.0',
          private: true,
          scripts: {
            // Host/port are supplied at runtime via env by the provider so the
            // sandbox's existing URL plumbing keeps working.
            dev: 'next dev -H 0.0.0.0',
            build: 'next build',
            start: 'next start',
          },
          dependencies: {
            next: '^14.2.5',
            react: '^18.2.0',
            'react-dom': '^18.2.0',
          },
          devDependencies: {
            tailwindcss: '^3.4.0',
            postcss: '^8.4.31',
            autoprefixer: '^10.4.16',
          },
        },
        null,
        2
      ),
    },
    {
      path: 'next.config.mjs',
      content: `/** @type {import('next').NextConfig} */
const nextConfig = {};

export default nextConfig;
`,
    },
    {
      path: 'jsconfig.json',
      content: JSON.stringify({ compilerOptions: { paths: { '@/*': ['./*'] } } }, null, 2),
    },
    {
      path: 'tailwind.config.js',
      content: `/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,jsx,ts,tsx}",
    "./components/**/*.{js,jsx,ts,tsx}",
  ],
  theme: { extend: {} },
  plugins: [],
};
`,
    },
    {
      path: 'postcss.config.js',
      content: `module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
`,
    },
    {
      path: 'app/globals.css',
      content: `@tailwind base;
@tailwind components;
@tailwind utilities;
`,
    },
    {
      path: 'app/layout.jsx',
      content: `import './globals.css';

export const metadata = {
  // Deploys inject NEXT_PUBLIC_APP_NAME (the project's name) at build time.
  title: process.env.NEXT_PUBLIC_APP_NAME || 'App',
  description: 'Built with Etlaq',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
`,
    },
    {
      path: 'app/page.jsx',
      content: `export default function Page() {
  return (
    <main className="min-h-screen flex items-center justify-center p-4">
      <div className="text-center max-w-2xl">
        <p className="text-lg text-gray-500">
          Sandbox Ready<br />
          Start building your full-stack Next.js app!
        </p>
      </div>
    </main>
  );
}
`,
    },
  ],
  promptGuidance: `

=== FRAMEWORK: Next.js (App Router) ===
This is a full-stack Next.js 14 App Router app, NOT Vite. Follow these rules:
- Pages live under app/. The home page is app/page.jsx. Nested routes are app/<route>/page.jsx.
- The root layout app/layout.jsx already exists and imports app/globals.css — put global styles there.
- There is NO index.html and NO src/ directory. Never create src/main.jsx, index.html, or a React Router setup — routing is file-based via the app/ directory.
- This is a plain JavaScript project (.jsx/.js), NOT TypeScript. NEVER write TypeScript syntax: no \`import type\`, no type annotations (\`: Metadata\`, \`: React.ReactNode\`, \`: string\`), no \`interface\`/\`type\` declarations, no generics (\`useState<Note[]>()\`), no \`as\` casts. For page metadata write \`export const metadata = { title: '...', description: '...' };\` with NO type annotation and NO \`import type { Metadata }\`. Function params take no annotations: \`export default function RootLayout({ children }) { ... }\`.
- Import YOUR OWN files with the '@/' path alias, which is rooted at the project (already configured in jsconfig.json): e.g. import Header from '@/components/Header' or import { supabase } from '@/lib/supabaseClient'. A correct relative path ('./', '../') also works. NEVER use a bare specifier like 'lib/supabase' or 'components/Header' — Next.js resolves those as npm packages and the build fails with "Module not found: Can't resolve 'lib/...'".
- Components are React Server Components by default. Add "use client" as the FIRST line of any file that uses hooks (useState/useEffect), browser APIs, or event handlers.
- NEVER access window, document, or localStorage at module scope or during render — pages are pre-rendered on the server at build time where those don't exist ("window is not defined" breaks the production build, even in "use client" files). Only touch them inside useEffect or event handlers, or guard with typeof window !== 'undefined'.
- Backend logic goes in Route Handlers: app/api/<name>/route.js exporting async GET/POST/etc. Use these for anything that must run on the server or hold secrets.
- Read public config via process.env.NEXT_PUBLIC_* (e.g. process.env.NEXT_PUBLIC_SUPABASE_URL). Server-only secrets use process.env.* (no NEXT_PUBLIC_ prefix) and must only be read inside Route Handlers / server components.
- Do NOT create package.json, next.config.mjs, tailwind.config.js, postcss.config.js, or jsconfig.json — they already exist.
- Use Tailwind CSS utility classes for styling.
- Apply the DESIGN EXCELLENCE guidance here too. Load distinctive fonts by adding a
  Google Fonts @import as the FIRST line of app/globals.css (above @tailwind), or use
  next/font in app/layout.jsx. Put base font-family, gradient-mesh backgrounds, and any
  @keyframes reveal utilities in app/globals.css @layer base/@layer utilities.
- The first file you output should be app/globals.css (if changing global styles), and the main page should be app/page.jsx.
`,
};

const TEMPLATES: Record<Framework, Template> = { vite: VITE, nextjs: NEXTJS };

export function getTemplate(framework: Framework | string | null | undefined): Template {
  return framework === 'nextjs' ? TEMPLATES.nextjs : TEMPLATES.vite;
}

// -----------------------------------------------------------------------------
// Auto-detect the framework from the user's build request. Conservative: only
// picks Next.js when the request clearly implies a backend (auth, data that
// persists, server logic, payments). Everything else stays a static Vite SPA.
//
// This is a lightweight keyword heuristic — good enough to route the common
// cases and cheap. It can later be replaced by an LLM classifier if needed.
// -----------------------------------------------------------------------------
const BACKEND_SIGNALS = [
  'login', 'log in', 'sign in', 'sign up', 'signup', 'signin', 'auth', 'account', 'register',
  'user', 'users', 'password', 'profile',
  'database', 'db', 'save', 'persist', 'store data', 'crud', 'record', 'records',
  'dashboard', 'admin', 'backend', 'server', 'api ', 'rest api',
  'payment', 'checkout', 'stripe', 'subscription', 'billing', 'pricing plan',
  'booking', 'reservation', 'order', 'orders', 'cart', 'ecommerce', 'e-commerce',
  'upload', 'comment', 'comments', 'post', 'posts', 'message', 'chat', 'notification',
  'email', 'newsletter', 'contact form', 'submit', 'form submission',
  'todo app', 'blog', 'cms', 'inventory', 'appointment', 'multi-user', 'realtime', 'real-time',
  // Voice / audio apps need a server route to transcribe (Whisper key stays server-side).
  'voice', 'voice note', 'voice notes', 'audio', 'record', 'recording', 'transcribe',
  'transcription', 'speech', 'speech-to-text', 'dictation', 'podcast',
];

export function detectFramework(prompt: string | null | undefined): Framework {
  if (!prompt) return 'vite';
  const text = prompt.toLowerCase();
  return BACKEND_SIGNALS.some((sig) => text.includes(sig)) ? 'nextjs' : 'vite';
}
