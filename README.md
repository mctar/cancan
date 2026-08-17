# SPRAY COLLECTIVE — Digital Spray Wall

A zero-touch digital spray-can experience. SPRAY COLLECTIVE uses the webcam and local
MediaPipe hand tracking to let people paint, switch tools, undo, save, and
operate the command wheel with gestures.

## Prerequisites

- Node.js `>=22.13.0`

## Quick Start

```bash
npm install
npm run dev
npm run build
npm run build:pages
```

The normal build targets OpenAI Sites. `build:pages` creates a fully static
version in `pages-dist/` for GitHub Pages. All hand tracking runs locally in the
browser; camera frames are not uploaded.

## Controls

- Move your index finger to aim.
- Pinch to spray.
- Hold an open palm to enter Command Mode.
- Aim, pinch, and hold briefly to select a command.
- Hold a closed fist to exit Command Mode.

## GitHub Pages

Pushes to `main` run `.github/workflows/deploy-pages.yml`, build the static app,
and deploy it to GitHub Pages. The intended custom domain is
`cancan.btrbot.com`.

For the custom hostname, configure the Pages setting for
`cancan.btrbot.com`, then add a DNS `CNAME` named `cancan` pointing to
`mctar.github.io`.
