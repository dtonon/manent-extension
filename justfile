set shell := ["bash", "-euo", "pipefail", "-c"]

chromium := "/Applications/Chromium.app/Contents/MacOS/Chromium"
test_url := "https://en.wikipedia.org/wiki/Nostr"

version := `node -p "require('./package.json').version"`

default:
    @just --list

# Type-check and build both browsers
test:
    pnpm exec tsc --noEmit
    pnpm build
    pnpm build:firefox

# Print the code version and the latest tag
version:
    @echo "code: {{version}}"
    @echo "tag:  $(git describe --tags --abbrev=0 2>/dev/null || echo none)"

# Build and launch Chromium with the extension in a fresh profile
run:
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

# Build the release zips for both browsers (Firefox also gets the sources zip for AMO)
dist:
    rm -f .output/*.zip
    pnpm zip
    pnpm zip:firefox
    # WXT zips the sources from disk, untracked local files included: only tracked files go out
    git archive --format=zip -o .output/manent-extension-{{version}}-sources.zip HEAD
    @ls -1 .output/manent-extension-{{version}}-*.zip

# Add an entry to the changelog: just log "Save Threads posts"
log entry:
    #!/usr/bin/env bash
    set -euo pipefail
    grep -q '^## \[Unreleased\]' CHANGELOG.md || { echo "no Unreleased section in CHANGELOG.md"; exit 1; }
    # Append after the last bullet of Unreleased, or at its end when it has none
    ENTRY={{quote(entry)}} awk '
        { line[NR] = $0 }
        /^## \[Unreleased\]/ { start = NR; next }
        start && !stop && /^## / { stop = NR }
        start && !stop && /^- / { last = NR }
        END {
            if (!stop) stop = NR + 1
            at = last
            if (!at) { at = stop - 1; while (at > start && line[at] == "") at-- }
            for (i = 1; i <= NR; i++) {
                print line[i]
                if (i == at) { if (!last) print ""; print "- " ENVIRON["ENTRY"] }
            }
        }
    ' CHANGELOG.md > CHANGELOG.md.tmp && mv CHANGELOG.md.tmp CHANGELOG.md
    echo "Unreleased is now:"
    awk '/^## \[Unreleased\]/{f=1;next} /^## \[/{f=0} f' CHANGELOG.md

# Bump the version and changelog, commit and tag (no push)
release VERSION:
    #!/usr/bin/env bash
    set -euo pipefail
    v="{{VERSION}}"
    [[ "$v" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "version must be X.Y.Z"; exit 1; }
    [[ -z "$(git status --porcelain)" ]] || { echo "working tree not clean"; exit 1; }
    ! git rev-parse -q --verify "refs/tags/v$v" >/dev/null || { echo "tag v$v exists"; exit 1; }
    grep -q '^## \[Unreleased\]' CHANGELOG.md || { echo "no Unreleased section in CHANGELOG.md"; exit 1; }
    [[ -n "$(awk '/^## \[Unreleased\]/{f=1;next} /^## \[/{f=0} f && /^- /' CHANGELOG.md)" ]] || { echo "no entries under Unreleased in CHANGELOG.md"; exit 1; }
    just test
    npm pkg set version="$v"
    sed -i '' "s/^## \[Unreleased\]/## [Unreleased]\n\n## [$v] - $(date +%Y-%m-%d)/" CHANGELOG.md
    git add package.json CHANGELOG.md
    git commit -m "Release v$v"
    git tag -a "v$v" -m "v$v"
    echo "Released v$v, push with: git push --follow-tags"

# Create the GitHub release for the current version with the zips attached; `just publish draft` for a draft
publish MODE="":
    #!/usr/bin/env bash
    set -euo pipefail
    v="{{version}}"; tag="v$v"
    [[ -z "$(git status --porcelain)" ]] || { echo "working tree not clean"; exit 1; }
    git rev-parse -q --verify "refs/tags/$tag" >/dev/null || { echo "tag $tag not found, run: just release $v"; exit 1; }
    [[ -n "$(git ls-remote --tags origin "$tag")" ]] || { echo "tag $tag not on origin, run: git push --follow-tags"; exit 1; }
    notes="$(awk -v h="## [$v]" 'index($0,h)==1{f=1;next} /^## \[/{f=0} f' CHANGELOG.md)"
    just dist
    files=(.output/manent-extension-"$v"-*.zip)
    if gh release view "$tag" > /dev/null 2>&1; then
        gh release edit "$tag" --title "$tag" --notes "$notes"
        gh release upload "$tag" "${files[@]}" --clobber
    else
        draft=""
        [[ "{{MODE}}" != "draft" ]] || draft="--draft"
        gh release create "$tag" "${files[@]}" --title "$tag" --notes "$notes" $draft
    fi

# Release, push and publish in one go: `just ship X.Y.Z [draft]`
ship VERSION MODE="":
    just release {{VERSION}}
    git push --follow-tags
    just publish "{{MODE}}"

# Undo the last release: `just undo release` (local only) | `just undo ship` (also deletes the github release and remote tag)
undo action:
    #!/usr/bin/env bash
    set -euo pipefail
    v="{{version}}"; tag="v$v"
    [[ "{{action}}" == "release" || "{{action}}" == "ship" ]] || { echo "unknown action: {{action}} (release | ship)"; exit 1; }
    [[ "$(git log -1 --format=%s)" == "Release $tag" ]] || { echo "last commit is not 'Release $tag', nothing to undo"; exit 1; }
    [[ -z "$(git status --porcelain)" ]] || { echo "working tree not clean"; exit 1; }
    on_origin="$(git ls-remote --tags origin "$tag")"
    if [[ "{{action}}" == "release" ]]; then
        [[ -z "$on_origin" ]] || { echo "tag $tag is already on origin, use: just undo ship"; exit 1; }
        read -r -p "Undo local release $tag (drop the tag and reset the last commit)? [y/N] " a
        [[ "$a" == "y" || "$a" == "Y" ]] || exit 1
    else
        read -r -p "Undo shipped $tag (delete the github release and remote tag, force-push the removal)? [y/N] " a
        [[ "$a" == "y" || "$a" == "Y" ]] || exit 1
        ! gh release view "$tag" > /dev/null 2>&1 || gh release delete "$tag" --yes
        [[ -z "$on_origin" ]] || git push origin ":refs/tags/$tag"
    fi
    ! git rev-parse -q --verify "refs/tags/$tag" > /dev/null || git tag -d "$tag"
    git reset --hard HEAD~1
    if [[ "{{action}}" == "ship" ]]; then
        git push --force-with-lease origin master
        echo "Shipped $tag undone; note that anyone who already fetched the tag keeps it"
    else
        echo "Release $tag undone"
    fi
