#!/usr/bin/env bash
# Download every third-party front-end file listed in static_files/vendor.lock into
# static_files/static/ and verify its SHA-256. Existing copies are deleted first, so
# every run is a fresh, verified download. Exits non-zero if any file fails.
#
#   static_files/fetch_vendor.sh        (run before collectstatic on the server)
set -uo pipefail
cd "$(dirname "$0")/.."
LOCK=static_files/vendor.lock

failed=0
while read -r sha path url; do
    [[ -z "${sha:-}" || "$sha" == \#* ]] && continue
    rm -f "$path"
    mkdir -p "$(dirname "$path")"
    tmp="$path.part"
    if ! curl -fsSL --retry 3 --max-time 60 "$url" -o "$tmp"; then
        echo "FAIL download  $path  ($url)"; rm -f "$tmp"; failed=1; continue
    fi
    got=$(sha256sum "$tmp" | cut -c1-64)
    if [[ "$got" != "$sha" ]]; then
        echo "FAIL checksum  $path  (expected $sha, got $got)"; rm -f "$tmp"; failed=1; continue
    fi
    mv "$tmp" "$path"
    echo "ok   $path"
done < "$LOCK"

if [[ $failed -ne 0 ]]; then
    echo "Some files failed; the pages that use them will be broken." >&2
    exit 1
fi
echo "All vendored files downloaded and verified."
