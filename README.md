# Azalea

Web management UI for VyOS. One Debian package, one Rust daemon, no runtime
dependencies beyond the router itself.

    curl -fsSL https://nightshadesystems.github.io/azalea/install.sh | sudo bash

Then open `https://<router>:8443` and sign in with a VyOS local user.

## Layout

- `src/azalea-webd/` — axum daemon: serves the exported UI and `/api/*`
- `src/azalea-vyos/` — VyOS op-mode backend (real + mock), parsers, fixtures
- `src/azalea-common/` — shared types, settings loader
- `web/` — Next.js static export (Nightshade Clarity, TypeScript)
- `packaging/` — cargo-deb config, systemd unit, `install.sh`
- `design/` — Nightshade Systems design system export and the Azalea brand kit

## Development

    cd web && npm ci && npm run build && cd ..
    cargo run -p azalea-webd -- --http-port 8080 --dev-listen http \
        --dev-auth admin:admin --assets web/out --mock

Open http://localhost:8080. `npm run dev` in `web/` proxies `/api/*` to
port 8080 (override with `AZALEA_WEBD_URL`).

## On the router

State lives in `/config/azalea/` (`azalea.toml`, `tls/`), which survives
image upgrades; the package itself is reinstalled by a postconfig hook.
