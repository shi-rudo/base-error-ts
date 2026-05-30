import { defineConfig } from "vitepress";

// https://vitepress.dev/reference/site-config
export default defineConfig({
  title: "@shirudo/base-error",
  description:
    "Cross-environment base error class for TypeScript — safe-by-default public projection, structured errors, RFC 9457 Problem Details.",
  // GitHub Pages project site is served from /base-error-ts/
  base: "/base-error-ts/",
  lastUpdated: true,
  cleanUrls: true,

  themeConfig: {
    nav: [
      { text: "Guide", link: "/guide/getting-started" },
      { text: "Migration", link: "/guide/migration" },
      {
        text: "v5",
        items: [
          {
            text: "Changelog",
            link: "https://github.com/shi-rudo/base-error-ts/blob/main/CHANGELOG.md",
          },
          { text: "npm", link: "https://www.npmjs.com/package/@shirudo/base-error" },
        ],
      },
    ],

    sidebar: {
      "/guide/": [
        {
          text: "Introduction",
          items: [
            { text: "Getting Started", link: "/guide/getting-started" },
            { text: "Why safe by default", link: "/guide/safe-by-default" },
            { text: "Pitfalls", link: "/guide/pitfalls" },
          ],
        },
        {
          text: "Core",
          items: [
            { text: "BaseError", link: "/guide/base-error" },
            { text: "StructuredError", link: "/guide/structured-error" },
            { text: "Error catalog", link: "/guide/catalog" },
            { text: "Matching errors", link: "/guide/matching" },
            { text: "Cause chains", link: "/guide/cause-chains" },
          ],
        },
        {
          text: "Boundaries",
          items: [
            { text: "Problem Details", link: "/guide/problem-details" },
            { text: "Error responses", link: "/guide/error-responses" },
            { text: "Observability & logging", link: "/guide/observability" },
          ],
        },
        {
          text: "Reference",
          items: [{ text: "Migration v4 → v5", link: "/guide/migration" }],
        },
      ],
    },

    socialLinks: [
      { icon: "github", link: "https://github.com/shi-rudo/base-error-ts" },
    ],

    search: { provider: "local" },

    editLink: {
      pattern:
        "https://github.com/shi-rudo/base-error-ts/edit/main/docs/:path",
      text: "Edit this page on GitHub",
    },

    footer: {
      message: "Released under the MIT License.",
      copyright: "Copyright © shi-rudo",
    },
  },
});
