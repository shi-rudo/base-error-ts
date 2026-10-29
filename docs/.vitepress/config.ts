import { defineConfig } from "vitepress";

import packageJson from "../../package.json";

const majorVersion = packageJson.version.split(".")[0];

// https://vitepress.dev/reference/site-config
export default defineConfig({
  title: "@shirudo/base-error",
  description:
    "Cross-environment base error class for TypeScript: safe-by-default public projection, structured errors, RFC 9457 Problem Details.",
  // GitHub Pages project site is served from /base-error-ts/
  base: "/base-error-ts/",
  lastUpdated: true,
  cleanUrls: true,

  vite: {
    build: {
      // Vite's default browser targets with Safari 14.1 instead of 14.0.
      // esbuild 0.28 counts destructuring as supported from Safari 14.1 and
      // cannot lower it, so the "safari14" target fails the build. This is
      // the target of the docs site; the package targets ES2020 (tsconfig).
      target: ["es2020", "edge88", "firefox78", "chrome87", "safari14.1"],
    },
  },

  themeConfig: {
    nav: [
      { text: "Guide", link: "/guide/getting-started" },
      { text: "Migration", link: "/guide/migration" },
      {
        text: `v${majorVersion}`,
        items: [
          {
            text: "Changelog",
            link: "https://github.com/shi-rudo/base-error-ts/blob/main/CHANGELOG.md",
          },
          {
            text: "npm",
            link: "https://www.npmjs.com/package/@shirudo/base-error",
          },
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
            {
              text: "Catalog composition",
              link: "/guide/catalog-composition",
            },
            { text: "Validation errors", link: "/guide/validation" },
            { text: "Matching errors", link: "/guide/matching" },
            { text: "Cause chains", link: "/guide/cause-chains" },
            { text: "Type guards & assertions", link: "/guide/guards" },
          ],
        },
        {
          text: "Boundaries",
          items: [
            {
              text: "Public error pipeline",
              link: "/guide/public-error",
            },
            { text: "Observability & logging", link: "/guide/observability" },
            { text: "Logging with pino", link: "/guide/logging-with-pino" },
            { text: "Reporting to Sentry", link: "/guide/reporting-to-sentry" },
          ],
        },
        {
          text: "Reference",
          items: [{ text: "Migration", link: "/guide/migration" }],
        },
      ],
    },

    socialLinks: [
      { icon: "github", link: "https://github.com/shi-rudo/base-error-ts" },
    ],

    search: { provider: "local" },

    editLink: {
      pattern: "https://github.com/shi-rudo/base-error-ts/edit/main/docs/:path",
      text: "Edit this page on GitHub",
    },

    footer: {
      message: "Released under the MIT License.",
      copyright: "Copyright © shi-rudo",
    },
  },
});
