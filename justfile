chromium := "/Applications/Chromium.app/Contents/MacOS/Chromium"
test_url := "https://en.wikipedia.org/wiki/Nostr"

default:
    @just --list

# Build and launch Chromium with the extension in a fresh profile
test:
    #!/usr/bin/env bash
    set -euo pipefail
    pnpm build
    pkill -f manent-ext-profile || true
    sleep 1
    profile="$(mktemp -d /tmp/manent-ext-profile.XXXXXX)"
    nohup "{{ chromium }}" \
        --user-data-dir="$profile" \
        --load-extension="$PWD/.output/chrome-mv3" \
        --no-first-run \
        --remote-debugging-port=9222 \
        "{{ test_url }}" > /dev/null 2>&1 &
    echo "Launched Chromium with fresh profile $profile"
    echo "A fresh profile is required on every rebuild, the MV3 worker script is cached otherwise"

# Build Chrome and Firefox versions
build:
    pnpm build
    pnpm build:firefox

# Bump the version and create the release zips for both browsers
release version:
    npm pkg set version={{ version }}
    pnpm zip
    pnpm zip:firefox
    @echo
    @ls -1 .output/*.zip
    @echo
    @echo "Next: git add -A && git commit -m 'Release {{ version }}' && git tag v{{ version }}"
