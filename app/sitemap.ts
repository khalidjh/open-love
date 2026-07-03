import type { MetadataRoute } from "next";

const SITE_URL = "https://build.etlaq.sa";

// Only public, indexable pages belong here.
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: `${SITE_URL}/`,
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${SITE_URL}/login`,
      changeFrequency: "monthly",
      priority: 0.5,
    },
  ];
}
