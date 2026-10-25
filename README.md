# Wollet

A simple place to keep your cards, accounts, and everyday details together.

Wollet is a small wallet app that runs in your browser. Everything you add stays on your device. There is no sign-up, no account, and no bank connection.

## What it does

- Keeps cards, bank accounts, and payment handles in one place.
- Lets you swipe a card to share it, then release to show the code.
- Includes a card style picker with colors, textures, and shuffle.
- Filters by item type and copies details with one tap.
- Lets you set a PIN and lock the cards/things on demand.

## Privacy
Wollet encrypts your wallet on your device with AES-256-GCM before saving it. Setting a PIN locks it, and the PIN itself is never stored. Wallet data is not sent to a server.

## Run it

Requires Node 22.13 or newer.

```bash
npm install
npm run dev
```

Open the local URL printed in the terminal.

## Test and build

```bash
npm test
npm run build
npm start
```

`npm test` checks encryption, PIN verification, QR and share safety, and the empty-start behavior.

## Project layout

- `app/` — the wallet UI, styles, and page entry
- `lib/` — vault storage, encryption, QR sharing, and formatting
- `public/` — manifest, service worker, offline page, icons, and fonts
- `tests/` — unit tests for storage and sharing
