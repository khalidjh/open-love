import { redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/server";
import MarketingHome from "@/components/home/MarketingHome";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  // Logged-in users go straight to their dashboard; visitors see the marketing page.
  const user = await getUser();
  if (user) redirect("/dashboard");

  return <MarketingHome />;
}
