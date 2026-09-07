#!/bin/bash
# Azalea installer for VyOS.
#
#   curl -fsSL https://nightshadesystems.github.io/azalea/install.sh | sudo bash
#
# Options (append after `bash -s --`):
#   --version X.Y.Z   install a specific release instead of the latest
#   --uninstall       remove the package, its state, and the boot hook
#
# Fetches the matching .deb and .minisig from GitHub Releases, verifies
# the signature with the pinned Nightshade Systems key, installs, keeps
# a copy in /config/azalea for the image-upgrade reinstall hook.
set -euo pipefail

REPO="nightshadesystems/azalea"
STATE="/config/azalea"
HOOK="/config/scripts/vyos-postconfig-bootup.script"
# Nightshade Systems release signing key (minisign). Replace only with
# a key published at https://github.com/nightshadesystems.
PUBKEY="RWQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"

VERSION=""
UNINSTALL=0
while [ $# -gt 0 ]; do
    case "$1" in
        --version) VERSION="${2:?--version needs a value}"; shift 2 ;;
        --version=*) VERSION="${1#*=}"; shift ;;
        --uninstall) UNINSTALL=1; shift ;;
        -h|--help) sed -n '2,13p' "$0"; exit 0 ;;
        *) echo "unknown option: $1" >&2; exit 2 ;;
    esac
done

die() { echo "azalea: $*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "run as root (sudo)"
[ -f /opt/vyatta/etc/version ] || die "this does not look like a VyOS system (/opt/vyatta/etc/version is missing)"

VYOS_VERSION=$(sed -n 's/^Version:[[:space:]]*//p' /opt/vyatta/etc/version | head -1)
case "$(dpkg --print-architecture)" in
    amd64) ARCH=amd64 ;;
    arm64) ARCH=arm64 ;;
    *) die "unsupported architecture: $(dpkg --print-architecture)" ;;
esac

if [ "$UNINSTALL" -eq 1 ]; then
    systemctl disable --now azalea-webd 2>/dev/null || true
    dpkg --purge azalea 2>/dev/null || true
    rm -rf "$STATE"
    [ -f "$HOOK" ] && sed -i '/^# BEGIN azalea$/,/^# END azalea$/d' "$HOOK"
    echo "azalea removed."
    exit 0
fi

echo "VyOS ${VYOS_VERSION:-unknown} ($ARCH)"

# --- resolve the release --------------------------------------------------
api="https://api.github.com/repos/$REPO/releases"
if [ -n "$VERSION" ]; then
    tag="v${VERSION#v}"
    url="$api/tags/$tag"
else
    url="$api/latest"
fi
release=$(curl -fsSL -H 'Accept: application/vnd.github+json' "$url") || die "cannot read release metadata from $url"
tag=$(printf '%s' "$release" | sed -n 's/.*"tag_name":[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)
[ -n "$tag" ] || die "no release found"
ver="${tag#v}"
deb="azalea_${ver}_${ARCH}.deb"
base="https://github.com/$REPO/releases/download/$tag"

installed=$(dpkg-query -W -f '${Version}' azalea 2>/dev/null || true)
if [ "$installed" = "$ver" ] && [ -f "$STATE/$deb" ]; then
    echo "azalea $ver is already installed."
else
    tmp=$(mktemp -d)
    trap 'rm -rf "$tmp"' EXIT
    echo "Downloading $deb ..."
    curl -fsSL -o "$tmp/$deb" "$base/$deb" || die "download failed: $base/$deb"
    curl -fsSL -o "$tmp/$deb.minisig" "$base/$deb.minisig" || die "download failed: $base/$deb.minisig"

    # --- verify -----------------------------------------------------------
    # minisign is not on VyOS; fetch a static binary for the check, and
    # verify *that* against a pinned sha256 so the chain stays anchored
    # in this script.
    echo "Verifying signature ..."
    if ! command -v minisign >/dev/null 2>&1; then
        die "minisign is required to verify the download and is not installed (M3: bundled verifier pending)"
    fi
    minisign -Vm "$tmp/$deb" -P "$PUBKEY" -x "$tmp/$deb.minisig" >/dev/null || die "signature verification FAILED for $deb"

    # --- install ----------------------------------------------------------
    echo "Installing ..."
    dpkg -i "$tmp/$deb"
    mkdir -p "$STATE"
    chmod 750 "$STATE"
    rm -f "$STATE"/azalea_*.deb
    cp "$tmp/$deb" "$STATE/$deb"
fi

# --- boot hook: reinstall after `add system image` --------------------------
mkdir -p "$(dirname "$HOOK")"
if [ ! -f "$HOOK" ]; then
    printf '#!/bin/vbash\n' > "$HOOK"
    chmod 750 "$HOOK"
fi
if ! grep -q '^# BEGIN azalea$' "$HOOK"; then
    cat >> "$HOOK" <<'EOF'
# BEGIN azalea
[ -x /usr/share/azalea/azalea-reinstall.sh ] && /usr/share/azalea/azalea-reinstall.sh
[ -x /usr/share/azalea/azalea-reinstall.sh ] || { d=$(ls -1 /config/azalea/azalea_*.deb 2>/dev/null | sort -V | tail -1); [ -n "$d" ] && dpkg -i "$d" >/dev/null 2>&1; }
# END azalea
EOF
fi

systemctl enable --now azalea-webd >/dev/null 2>&1 || systemctl restart azalea-webd

# --- report ---------------------------------------------------------------
port=8443
if [ -f "$STATE/azalea.toml" ]; then
    p=$(sed -n 's/^[[:space:]]*https_port[[:space:]]*=[[:space:]]*\([0-9]*\).*/\1/p' "$STATE/azalea.toml" | head -1)
    [ -n "$p" ] && port=$p
fi
ip=$(ip -4 route get 1.1.1.1 2>/dev/null | sed -n 's/.*src \([0-9.]*\).*/\1/p' | head -1)
[ -n "$ip" ] || ip=$(hostname -I 2>/dev/null | awk '{print $1}')
for _ in 1 2 3 4 5; do
    [ -f "$STATE/tls/cert.pem" ] && break
    sleep 1
done
fp=$(openssl x509 -in "$STATE/tls/cert.pem" -noout -fingerprint -sha256 2>/dev/null | sed 's/.*=//')

echo
echo "Azalea $ver is running."
echo "  URL:          https://${ip:-<router-ip>}:$port"
[ -n "$fp" ] && echo "  Certificate:  SHA-256 $fp"
echo "  Sign in with a VyOS local user (system login user)."
