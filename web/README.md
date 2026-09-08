# Azalea web UI

Next.js app exported to static files and served by `azalea-webd` together
with the JSON API under `/api/*`. Styling is Nightshade Clarity
(`styles/` tokens + framework, `components/ds/` typed React components),
self-hosted end to end: fonts via @fontsource, Clarity Icons pinned into
`public/vendor/`. No CDN — routers are often air-gapped.

`lib/types.ts` mirrors the serde structs in `azalea-common` by hand.

## Development

    npm ci
    npm run build          # static export to web/out/

Run the daemon off-box:

    cargo run -p azalea-webd -- --http-port 8080 --dev-listen http \
        --dev-auth admin:admin --assets web/out --mock

`--mock-train sagitta|circinus|rolling` picks which VyOS release the
mock claims to be (1.4, 1.5, rolling); the UI hides what that release
lacks, the same as it does for a real router.

then open http://localhost:8080. For hot reload run `npm run dev`; it
proxies `/api/*` to port 8080 (override with `AZALEA_WEBD_URL`). Next's
rewrites do not carry WebSockets, so under `npm run dev` the Interfaces
pages show "Polling" and refetch every few seconds instead of streaming.
