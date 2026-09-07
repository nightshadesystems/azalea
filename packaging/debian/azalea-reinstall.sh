#!/bin/sh
# Runs from /config/scripts/vyos-postconfig-bootup.script on every boot.
#
# The VyOS root is a squashfs image: `add system image` boots a fresh
# one where dpkg has never heard of azalea. /config survives, so the
# installer keeps a copy of the .deb there and this script puts it back
# when the running image lacks it (or has an older version).
set -u

STATE=/config/azalea
DEB=$(find "$STATE" -maxdepth 1 -name 'azalea_*.deb' 2>/dev/null | sort -V | tail -1)
[ -n "$DEB" ] || exit 0

want=$(dpkg-deb -f "$DEB" Version 2>/dev/null) || exit 0
have=$(dpkg-query -W -f '${Version}' azalea 2>/dev/null || true)

if [ -z "$have" ] || dpkg --compare-versions "$have" lt "$want"; then
    logger -t azalea "reinstalling azalea $want from $DEB (image has '${have:-none}')"
    dpkg -i "$DEB" >/dev/null 2>&1 || logger -t azalea "dpkg -i $DEB failed"
fi
exit 0
