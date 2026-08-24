# Fix the "This page didn't load" error after publishing

## What is broken

The published site (and intermittently the preview) returns a 500 error page. The server log shows:

```text
Error: No such module "assets/react"
```

That means the hosted worker for the site was never built — only the static browser bundle was.

## Why it happened

Commit `f0ba084` ("add automatic AWS CloudFront deployment", Aug 19) changed the build so it produces **only** a static SPA for S3/CloudFront:

- `vite.config.ts` — added `nitro: false` (stops building the server worker) and `tanstackStart.spa.enabled: true`
- `src/start.ts` — added `defaultSsr: false`

Lovable hosting serves the app through that worker. With `nitro: false` there is no worker bundle, so every request to the Lovable/published URL falls back to a broken entry and returns the generic error page. AWS CloudFront kept working because it only needs `dist/client`.

So nothing in the app logic (dashboard, returns, analytics) broke the site — the hosting output did.

## The fix: one build config, two targets

Make the static-only settings conditional on an environment variable, so both workflows keep working from the same repo:

1. `vite.config.ts`
   - Read `process.env.STATIC_ONLY === "1"`.
   - When set: `nitro: false` and `tanstackStart.spa.enabled: true` (current AWS behaviour, unchanged).
   - When not set (Lovable publish, preview, local dev): leave `nitro` at its default so the worker bundle is produced again, and keep `server: { entry: "server" }` for the SSR error wrapper.
2. `src/start.ts`
   - Keep the app client-rendered in both modes to avoid new SSR-only bugs, but do it in a way that does not require the static build: keep `defaultSsr: false` as-is. This is safe with the worker because the worker still serves the shell and server functions.
3. `.github/workflows/deploy-aws.yml`
   - Set `STATIC_ONLY: 1` in the build step's env so the AWS build keeps emitting `dist/client/_shell.html` exactly as it does today.

## Verification

- Run the production build without `STATIC_ONLY` and confirm the worker output exists (`.output`/nitro server bundle present, no `No such module "assets/react"`).
- Run the build with `STATIC_ONLY=1` and confirm `dist/client/_shell.html` and `dist/client/assets/` are still produced for the AWS workflow.
- Reload the preview, then publish and load the published URL; check server logs are clean.

## Notes on working in both Codex and Lovable

- Keep `vite.config.ts` hosting logic env-gated as above; if a future Codex change needs static-only behaviour, set `STATIC_ONLY` in that workflow instead of hardcoding `nitro: false`.
- Avoid changing `tanstackStart.server.entry` — the SSR error wrapper in `src/server.ts` depends on it.
