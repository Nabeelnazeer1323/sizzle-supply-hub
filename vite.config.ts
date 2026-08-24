// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// STATIC_ONLY=1 builds a pure static SPA for the S3 + CloudFront deployment
// (see .github/workflows/deploy-aws.yml). Without it we keep the default
// nitro worker build that Lovable preview/publish hosting requires.
const staticOnly = process.env["STATIC_ONLY"] === "1";

export default defineConfig({
  ...(staticOnly ? { nitro: false as const } : {}),
  tanstackStart: {
    ...(staticOnly ? { spa: { enabled: true } } : {}),
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
});
