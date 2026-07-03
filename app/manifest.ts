import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Etlaq — Build web apps with AI",
    short_name: "Etlaq",
    description:
      "Etlaq turns a prompt into a working web app in seconds — describe it, refine it in chat, and preview live.",
    start_url: "/",
    display: "standalone",
    background_color: "#fbfafd",
    theme_color: "#fbfafd",
    icons: [
      {
        src: "/etlaq-logo.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
