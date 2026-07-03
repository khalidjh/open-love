import type { MetadataRoute } from "next";

const SITE_URL = "https://build.etlaq.sa";

// Allow crawling of public marketing/auth pages; keep the authenticated app
// surfaces and API out of the index.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/dashboard", "/builder", "/generation", "/projects"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
