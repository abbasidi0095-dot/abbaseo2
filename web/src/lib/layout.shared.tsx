import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: <span className="font-semibold">AbbaSeo</span>,
    },
    searchToggle: {
      enabled: false,
    },
    links: [
      {
        text: "Resources",
        url: "/blogs",
        items: [
          {
            text: "Blog",
            description: "SEO articles and guides.",
            url: "/blogs",
          },
          {
            text: "MCP",
            description: "Connect AbbaSeo to AI clients.",
            url: "/docs/mcp",
          },
          {
            text: "Skills",
            description: "Focused AbbaSeo workflows.",
            url: "/docs/skills",
          },
        ],
      },
      {
        text: "GitHub",
        url: "https://github.com/every-app/open-seo",
        external: true,
      },
    ],
  };
}
