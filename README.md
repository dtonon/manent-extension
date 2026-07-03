# Manent Extension

Browser extension to save web content (URLs, selected text) as personal notes in [Manent](https://github.com/dtonon/manent).

## Development

```sh
pnpm install
pnpm dev            # Chrome
pnpm dev:firefox    # Firefox
```

## Build

```sh
pnpm build          # -> .output/chrome-mv3
pnpm build:firefox  # -> .output/firefox-mv3
```

## Load in the browser

Chrome: open `chrome://extensions`, enable Developer mode, "Load unpacked", pick `.output/chrome-mv3`.

Firefox (128+): open `about:debugging#/runtime/this-firefox`, "Load Temporary Add-on", pick `.output/firefox-mv3/manifest.json`.

## Login methods

- NIP-07 signer extension (needs NIP-44 support, works only on regular web pages)
- nsec / hex key, optionally encrypted with a password (NIP-49)
- ncryptsec
