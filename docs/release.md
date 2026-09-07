# Releasing

## One-time: signing key

Releases are signed with minisign. Generate the key on a machine you
trust, not in CI:

    minisign -G -p azalea.pub -s azalea.key -W    # -W: no passphrase (CI needs it raw)

- Put the second line of `azalea.pub` into `PUBKEY=` in
  `packaging/install.sh` and commit it.
- Store the whole `azalea.key` file contents as the repository secret
  `MINISIGN_SECRET_KEY`. The release job refuses to sign if that key does
  not match the pinned public key.
- Keep `azalea.key` offline. Rotating the key means changing `install.sh`
  and re-signing.

## Cutting a release

1. Bump `version` in `Cargo.toml` (workspace) and `web/package.json`.
2. Commit, then tag and push: `git tag v0.1.0 && git push origin v0.1.0`.
3. The Release workflow builds amd64 and arm64 `.deb`s inside
   `rust:1.96-bookworm` (Debian 12 glibc, same as VyOS 1.4/1.5), signs
   them, and attaches `.deb`, `.minisig` and `SHA256SUMS` to the GitHub
   Release.
4. `install.sh` is published to Pages on every push to `main` that
   touches it; it always resolves the latest Release.

## Verifying a download by hand

    bash packaging/install.sh --verify azalea_0.1.0_amd64.deb

`--verify` needs only `openssl` and the `.minisig` next to the file.
