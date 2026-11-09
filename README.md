# Manent Extension

Save what you find on the web straight into [Manent](https://github.com/dtonon/manent), your private, encrypted space for notes and files built on [Nostr](https://njump.me).

A link, an article, a quote, an image or a video: one click and it lands among your Manent notes, encrypted on your device and synced through your own relays. Available for Chrome and Firefox.

## Features

- **Links** — Save the current page with its title, a comment and tags
- **Articles** — Save the full article in readable form, cleaned up with Readability
- **Selections** — Save the selected text as a quote, with its source
- **Images** — Save any image with a comment, uploaded to your Blossom servers, and mark it as sensitive
- **Screenshots** — Drag over the area to save, with guide lines for precise corners, or take the whole view; tagged #screenshot, and used for pages without a readable article
- **Videos and social posts** — Save YouTube videos and Shorts, Instagram reels, photo posts and carousels, and Facebook reels and photos with caption, author, date and cover
- **Context menu** — Save the article, a screenshot, a selection or an image right from the page, without opening the popup
- **Shortcuts** — Open the popup with `Alt+Shift+M`, or save the page link instantly with `Alt+Shift+S`
- **Retry** — Saves that fail to reach the relays wait in a queue, retried from the pending line in the popup or when the background worker starts
- **End-to-end encrypted** — Notes are encrypted with NIP-44 and files with AES-GCM before leaving the browser, in the same format Manent reads
- **Your relays, your servers** — Uses the relays (NIP-65) and Blossom servers listed in your Nostr profile. Both lists are read once and kept until you log out: log out and back in after changing them

## Login methods

- **NIP-07 signer** — Sign with a browser extension that supports NIP-44. The signer is reached through the open tab, so it works only on regular web pages, and that page could see the note before it is encrypted: use the nsec login if that matters to you
- **nsec / hex key** — Optionally encrypted with a password (NIP-49)
- **ncryptsec** — Paste a password-encrypted key

## Install

Download the latest zip for your browser from the [releases](https://github.com/dtonon/manent-extension/releases), then:

- **Chrome:** open `chrome://extensions`, enable Developer mode, unzip the file and pick its folder with "Load unpacked"
- **Firefox (128+):** open `about:debugging#/runtime/this-firefox`, "Load Temporary Add-on" and pick the zip

The Firefox install is temporary: the extension is removed when Firefox restarts and has to be loaded again. Regular Firefox installs only signed add-ons permanently, and the release zip is not signed.

## Privacy

The extension has no server of its own and no analytics: it only talks to Nostr relays and Blossom servers.

- **What is sent** — Only encrypted notes to your relays and encrypted files to your Blossom servers. Relays and servers can still see your public key, when each note was saved and the size of each file
- **Discovery** — Your public key is looked up on discovery relays (nos.lol, purplepag.es, relay.damus.io, nostr.wine, nostr.mom) to find your profile, your relay list and your Blossom server list
- **Fallbacks** — Without a relay list, notes go to nos.lol, nostr.mom and bitcoiner.social. Files are uploaded to the first Blossom server that accepts them, trying yours first and then nostr.download and cdn.hzrd149.com, since most public servers reject encrypted files. Small files travel inside the encrypted note instead
- **Stored in the browser** — Your account and key in the extension storage, as an ncryptsec when you set a password and in plain form otherwise (no key with a NIP-07 signer), plus the cached relay and server lists and the queue of pending saves

## Built with

- [WXT](https://wxt.dev) — web extension framework, Manifest V3 for both browsers
- [nostr-tools](https://github.com/nbd-wtf/nostr-tools) — Nostr events, NIP-44 encryption, NIP-49 keys
- [Readability](https://github.com/mozilla/readability) — article extraction

## Development

```sh
pnpm install
pnpm dev            # Chrome
pnpm dev:firefox    # Firefox
```

Build with `pnpm build` (`.output/chrome-mv3`) and `pnpm build:firefox` (`.output/firefox-mv3`), or both with `just build`. `just test` type-checks and builds both browsers, `just run` launches Chromium with the extension in a fresh profile: Chromium caches the MV3 worker, so every rebuild needs a new one.

To load a local build, pick `.output/chrome-mv3` with "Load unpacked" in Chrome, or `.output/firefox-mv3/manifest.json` with "Load Temporary Add-on" in Firefox.

## Release

Notable changes go in `CHANGELOG.md` under Unreleased (`just log "..."`). `just ship X.Y.Z` bumps the version, moves the entries under the new version, tags, pushes and creates the GitHub release with the zips attached; `just ship X.Y.Z draft` creates it as a draft.

## License

[MIT](LICENSE)
