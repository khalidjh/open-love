import { redirect } from "next/navigation";

// The projects list now lives inside the dashboard.
export default function ProjectsPage() {
  redirect("/dashboard");
}
