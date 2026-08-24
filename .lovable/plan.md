# Fix the published site returning "This page didn't load"

## What's wrong

Every request to sizzle-supply-hub.lovable.app returns HTTP 500. The server logs show the real cause:

```text
Error: No such module "assets/react".
  imported from "assets/server-B7OdOQHn.js"
```

The published site is served by a Cloudflare worker, but the current build no longer produces a bundled worker. `vite.config.ts` sets `nitro: false` (added along with the AWS/CloudFront static-hosting setup done outside Lovable). Without that build step, the server entry is emitted unbundled and tries to resolve `react` at runtime — which does not exist in the worker — so the SSR wrapper in `src/server.ts` catches the failure and returns the branded error page for every path.

The preview keeps working because the dev server resolves modules from `node_modules`; only the published worker breaks.

## The fix

Re-enable the worker build while keeping the static SPA output that the GitHub Actions AWS deploy uses:

- In `vite.config.ts`, remove `nitro: false` and keep `tanstackStart.spa.enabled` and the `server: { entry: "server" }` override.
- The build still emits `dist/client/` with `_shell.html`, so `.github/workflows/deploy-aws.yml` continues to work unchanged — it only uploads `dist/client/`.
- Republish, then verify `GET /` returns 200 and the dashboard loads, and confirm the worker logs no longer show the `No such module` error.

If you would rather keep the AWS build free of the worker step, the alternative is to gate it: `nitro: process.env.STATIC_ONLY === "1" ? false : undefined`, and set `STATIC_ONLY=1` in the AWS workflow's build step. Lovable publishing would then use the worker build, AWS the static one. Say the word if you want that variant instead of the simple removal.

## Note on the two hosting paths

This project is currently published in two places: Lovable's worker hosting and your own S3 + CloudFront distribution. Config changes made in the Codex/GitHub branch for CloudFront can break Lovable publishing, as happened here. Keeping the shared `vite.config.ts` worker-compatible (as above) avoids that.
