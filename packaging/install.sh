#!/bin/bash
# Azalea installer for VyOS.
#
#   curl -fsSL https://nightshadesystems.github.io/azalea/install.sh | sudo bash
#
# Options (append after `bash -s --`):
#   --version X.Y.Z   install a specific release instead of the latest
#   --deb FILE        install a local .deb (FILE.minisig must sit beside it)
#   --verify FILE     only check FILE against FILE.minisig and exit
#   --uninstall       remove the package, its state, and the boot hook
#
# Fetches the .deb and .minisig from GitHub Releases, verifies the
# minisign signature with the pinned Nightshade Systems key using the
# OpenSSL VyOS already ships, installs, and keeps a copy under
# /config/azalea so the boot hook can reinstall it after `add system
# image`. Rerunning upgrades in place.
set -euo pipefail

REPO="nightshadesystems/azalea"
STATE="/config/azalea"
HOOK="/config/scripts/vyos-postconfig-bootup.script"
# Nightshade Systems release signing key (minisign). AZALEA_PUBKEY in the
# environment overrides it for testing against a throwaway key.
PUBKEY="${AZALEA_PUBKEY:-RWQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA}"

VERSION=""
DEB_FILE=""
VERIFY_FILE=""
UNINSTALL=0
while [ $# -gt 0 ]; do
    case "$1" in
        --version) VERSION="${2:?--version needs a value}"; shift 2 ;;
        --version=*) VERSION="${1#*=}"; shift ;;
        --deb) DEB_FILE="${2:?--deb needs a file}"; shift 2 ;;
        --deb=*) DEB_FILE="${1#*=}"; shift ;;
        --verify) VERIFY_FILE="${2:?--verify needs a file}"; shift 2 ;;
        --verify=*) VERIFY_FILE="${1#*=}"; shift ;;
        --uninstall) UNINSTALL=1; shift ;;
        -h|--help) sed -n '2,16p' "$0"; exit 0 ;;
        *) echo "unknown option: $1" >&2; exit 2 ;;
    esac
done

die() { echo "azalea: $*" >&2; exit 1; }

# --- minisign verification with openssl ------------------------------------
# Format (https://jedisct1.github.io/minisign/): public key is
# base64("Ed" || key id[8] || ed25519 pk[32]); the .minisig has the
# signature base64(alg[2] || key id[8] || sig[64]) on line 2, a trusted
# comment on line 3, and base64(global sig[64]) over sig || comment on
# line 4. alg "ED" signs BLAKE2b-512(file), "Ed" signs the file itself.
verify_minisig() {
    local file="$1" sigfile="$2" pubkey="$3"
    local work
    work=$(mktemp -d)
    # shellcheck disable=SC2064
    trap "rm -rf '$work'" RETURN

    printf '%s' "$pubkey" | base64 -d > "$work/pk.bin" 2>/dev/null || return 1
    [ "$(stat -c %s "$work/pk.bin")" -eq 42 ] || return 1
    [ "$(head -c 2 "$work/pk.bin")" = "Ed" ] || return 1
    tail -c +3 "$work/pk.bin" | head -c 8 > "$work/pk.id"
    # SubjectPublicKeyInfo for Ed25519: fixed 12-byte DER prefix + raw key.
    { printf '\x30\x2a\x30\x05\x06\x03\x2b\x65\x70\x03\x21\x00'; tail -c 32 "$work/pk.bin"; } > "$work/pk.der"
    openssl pkey -pubin -inform DER -in "$work/pk.der" -out "$work/pk.pem" 2>/dev/null || return 1

    sed -n 2p "$sigfile" | base64 -d > "$work/sig.bin" 2>/dev/null || return 1
    [ "$(stat -c %s "$work/sig.bin")" -eq 74 ] || return 1
    local alg
    alg=$(head -c 2 "$work/sig.bin")
    tail -c +3 "$work/sig.bin" | head -c 8 > "$work/sig.id"
    cmp -s "$work/pk.id" "$work/sig.id" || { echo "azalea: signature was made with a different key" >&2; return 1; }
    tail -c 64 "$work/sig.bin" > "$work/sig.raw"

    case "$alg" in
        ED) openssl dgst -blake2b512 -binary "$file" > "$work/msg" ;;
        Ed) cp "$file" "$work/msg" ;;
        *) return 1 ;;
    esac
    openssl pkeyutl -verify -pubin -inkey "$work/pk.pem" -rawin -in "$work/msg" -sigfile "$work/sig.raw" >/dev/null 2>&1 || return 1

    # Global signature binds the trusted comment to the signature.
    local comment
    comment=$(sed -n 3p "$sigfile" | sed 's/^trusted comment: //')
    sed -n 4p "$sigfile" | base64 -d > "$work/gsig.raw" 2>/dev/null || return 1
    { cat "$work/sig.raw"; printf '%s' "$comment"; } > "$work/gmsg"
    openssl pkeyutl -verify -pubin -inkey "$work/pk.pem" -rawin -in "$work/gmsg" -sigfile "$work/gsig.raw" >/dev/null 2>&1 || return 1
    echo "$comment"
}

if [ -n "$VERIFY_FILE" ]; then
    comment=$(verify_minisig "$VERIFY_FILE" "$VERIFY_FILE.minisig" "$PUBKEY") || die "signature verification FAILED for $VERIFY_FILE"
    echo "OK: $VERIFY_FILE ($comment)"
    exit 0
fi

[ "$(id -u)" -eq 0 ] || die "run as root (sudo)"
[ -f /opt/vyatta/etc/version ] || die "this does not look like a VyOS system (/opt/vyatta/etc/version is missing)"
command -v openssl >/dev/null || die "openssl is required to verify the download"

# `Version: VyOS 1.4.1` (vyos.system.image reads it the same way).
VYOS_VERSION=$(sed -n 's/^Version:[[:space:]]*//p' /opt/vyatta/etc/version | head -1)
case "$(dpkg --print-architecture)" in
    amd64) ARCH=amd64 ;;
    arm64) ARCH=arm64 ;;
    *) die "unsupported architecture: $(dpkg --print-architecture)" ;;
esac
have_systemd() { [ -d /run/systemd/system ]; }

if [ "$UNINSTALL" -eq 1 ]; then
    have_systemd && systemctl disable --now azalea-webd 2>/dev/null || true
    dpkg --purge azalea 2>/dev/null || true
    rm -rf "$STATE"
    [ -f "$HOOK" ] && sed -i '/^# BEGIN azalea$/,/^# END azalea$/d' "$HOOK"
    echo "azalea removed."
    exit 0
fi

echo "Detected ${VYOS_VERSION:-unknown VyOS} ($ARCH)"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# --- obtain the package -----------------------------------------------------
if [ -n "$DEB_FILE" ]; then
    [ -f "$DEB_FILE" ] || die "no such file: $DEB_FILE"
    [ -f "$DEB_FILE.minisig" ] || die "missing signature: $DEB_FILE.minisig"
    deb=$(basename "$DEB_FILE")
    cp "$DEB_FILE" "$tmp/$deb"
    cp "$DEB_FILE.minisig" "$tmp/$deb.minisig"
    ver=$(dpkg-deb -f "$tmp/$deb" Version)
else
    api="https://api.github.com/repos/$REPO/releases"
    if [ -n "$VERSION" ]; then
        url="$api/tags/v${VERSION#v}"
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
    if [ "${installed%%-*}" = "$ver" ] && [ -f "$STATE/$deb" ]; then
        echo "azalea $ver is already installed."
        deb=""
    else
        echo "Downloading $deb ..."
        curl -fsSL -o "$tmp/$deb" "$base/$deb" || die "download failed: $base/$deb"
        curl -fsSL -o "$tmp/$deb.minisig" "$base/$deb.minisig" || die "download failed: $base/$deb.minisig"
    fi
fi

# --- verify and install ----------------------------------------------------
if [ -n "$deb" ]; then
    echo "Verifying signature ..."
    comment=$(verify_minisig "$tmp/$deb" "$tmp/$deb.minisig" "$PUBKEY") || die "signature verification FAILED for $deb — not installing"
    echo "Signature OK ($comment)"
    [ "$(dpkg-deb -f "$tmp/$deb" Architecture)" = "$ARCH" ] || die "$deb is not an $ARCH package"

    echo "Installing ..."
    dpkg -i "$tmp/$deb"
    mkdir -p "$STATE"
    chmod 750 "$STATE"
    rm -f "$STATE"/azalea_*.deb "$STATE"/azalea_*.deb.minisig
    cp "$tmp/$deb" "$STATE/$deb"
    cp "$tmp/$deb.minisig" "$STATE/$deb.minisig"
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
# Reinstall Azalea when a fresh image lacks it (the .deb lives in /config/azalea).
if [ -x /usr/share/azalea/azalea-reinstall.sh ]; then
    /usr/share/azalea/azalea-reinstall.sh
else
    d=$(find /config/azalea -maxdepth 1 -name 'azalea_*.deb' 2>/dev/null | sort -V | tail -1)
    [ -n "$d" ] && dpkg -i "$d" >/dev/null 2>&1 && systemctl enable --now azalea-webd >/dev/null 2>&1 || true
fi
# END azalea
EOF
fi

if have_systemd; then
    systemctl enable --now azalea-webd >/dev/null 2>&1 || systemctl restart azalea-webd
else
    echo "azalea: no systemd here; start azalea-webd yourself" >&2
fi

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
fp=$(openssl x509 -in "$STATE/tls/cert.pem" -noout -fingerprint -sha256 2>/dev/null | sed "s/.*=//") || fp=""

echo
echo "Azalea $ver is installed."
echo "  URL:          https://${ip:-<router-ip>}:$port"
[ -n "$fp" ] && echo "  Certificate:  SHA-256 $fp"
echo "  Sign in with a VyOS local user (system login user)."
