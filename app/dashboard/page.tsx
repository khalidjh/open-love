import { redirect } from "next/navigation";
import { requireOrg, UnauthorizedError } from "@/lib/auth";
import { listProjects } from "@/lib/db/repos";
import DashboardShell from "@/components/dashboard/DashboardShell";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  let user: Awaited<ReturnType<typeof requireOrg>>["user"];
  let orgId: string;
  try {
    ({ user, orgId } = await requireOrg());
  } catch (e) {
    if (e instanceof UnauthorizedError) redirect("/login");
    throw e;
  }

  const projects = await listProjects(orgId);

  // Serialize for the client component (Dates → ISO strings).
  const items = projects.map((p) => ({
    id: p.id,
    name: p.name,
    sourceUrl: p.sourceUrl ?? null,
    deployUrl: p.deployUrl ?? null,
    model: p.model ?? null,
    updatedAt: p.updatedAt.toISOString(),
  }));

  const email = user.email ?? "";
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const name =
    (typeof meta.full_name === "string" && meta.full_name) ||
    (typeof meta.name === "string" && meta.name) ||
    email.split("@")[0] ||
    "there";

  return <DashboardShell email={email} name={name} projects={items} />;
}
