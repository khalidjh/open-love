import { redirect, notFound } from "next/navigation";
import { requireOrg, UnauthorizedError } from "@/lib/auth";
import { getProject } from "@/lib/db/repos";
import ProjectSettings from "@/components/dashboard/ProjectSettings";

export const dynamic = "force-dynamic";

export default async function ProjectSettingsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  let orgId: string;
  try {
    ({ orgId } = await requireOrg());
  } catch (e) {
    if (e instanceof UnauthorizedError) redirect("/login");
    throw e;
  }

  const { id } = await params;
  const project = await getProject(orgId, id);
  if (!project) notFound();

  return (
    <ProjectSettings
      project={{
        id: project.id,
        name: project.name,
        deployUrl: project.deployUrl ?? null,
        deployTarget: (project.deployTarget as "static" | "fullstack" | null) ?? null,
        framework: (project.framework as "vite" | "nextjs" | null) ?? null,
        updatedAt: project.updatedAt.toISOString(),
      }}
    />
  );
}
