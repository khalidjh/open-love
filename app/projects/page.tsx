import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireOrg, UnauthorizedError } from '@/lib/auth';
import { listProjects } from '@/lib/db/repos';

export const dynamic = 'force-dynamic';

function timeAgo(date: Date) {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default async function ProjectsPage() {
  let orgId: string;
  try {
    ({ orgId } = await requireOrg());
  } catch (e) {
    if (e instanceof UnauthorizedError) redirect('/login');
    throw e;
  }

  const projects = await listProjects(orgId);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <h1 className="text-lg font-semibold flex items-center gap-2">🔥 Open Lovable</h1>
          <Link
            href="/generation"
            className="px-4 py-2 rounded-lg bg-orange-500 text-white text-sm font-medium hover:bg-orange-600"
          >
            + New app
          </Link>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8">
        <h2 className="text-xl font-semibold mb-1">Your apps</h2>
        <p className="text-sm text-gray-500 mb-6">
          {projects.length} {projects.length === 1 ? 'project' : 'projects'}
        </p>

        {projects.length === 0 ? (
          <div className="border border-dashed border-gray-300 rounded-xl p-12 text-center">
            <p className="text-gray-500 mb-4">You haven&apos;t built any apps yet.</p>
            <Link
              href="/generation"
              className="inline-block px-4 py-2 rounded-lg bg-orange-500 text-white text-sm font-medium hover:bg-orange-600"
            >
              Build your first app
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {projects.map((p) => (
              <Link
                key={p.id}
                href={`/generation?project=${p.id}`}
                className="block bg-white border border-gray-200 rounded-xl p-5 hover:border-orange-400 hover:shadow-sm transition"
              >
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-medium text-gray-900 truncate">{p.name}</h3>
                  {p.deployUrl && (
                    <span className="shrink-0 text-[10px] uppercase tracking-wide text-green-700 bg-green-100 px-2 py-0.5 rounded">
                      live
                    </span>
                  )}
                </div>
                {p.sourceUrl && (
                  <p className="text-xs text-gray-400 truncate mt-1">{p.sourceUrl}</p>
                )}
                <div className="flex items-center justify-between mt-4 text-xs text-gray-400">
                  <span>{p.model || 'app'}</span>
                  <span>{timeAgo(p.updatedAt)}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
