# 無限紙 · Mugengami — Endless Paper

A **free, open** infinite-canvas drawing & notes app for the **web and Android**. Draw, sketch, and think without edges — pan and zoom forever on a single boundless sheet.

> *Mugengami* (無限紙) = **mugen** 無限 "infinite / endless" + **kami / gami** 紙 "paper".

A free, web-based tribute to the lovely (iPad-only, paid) [Endless Paper](https://www.endlesspaper.app/) — rebuilt as a zero-cost Progressive Web App that runs in any modern browser and installs to your Android home screen.

## ✨ Features

- **Truly infinite canvas** — strokes are stored as vectors in world space, so panning and zooming stay razor-sharp at any scale.
- **Natural drawing** — pressure-sensitive pen (stylus & Apple/Samsung pen supported via Pointer Events), highlighter, and eraser.
- **Pinch to zoom, two-finger pan** on touch; scroll / `Ctrl`-scroll and hold `Space` to pan on desktop.
- **Dotted grid** and light / dark paper.
- **Undo / redo**, **PNG export**, and **auto-save** to your device (nothing leaves your browser).
- **Installable & offline** — full PWA with a service worker; works with no connection once loaded.
- **100% client-side** — no accounts, no servers, no tracking. Your drawings never leave your device.

## ⌨️ Shortcuts

| Key | Action | | Key | Action |
|---|---|---|---|---|
| `P` | Pen | | `Ctrl/⌘ + Z` | Undo |
| `M` | Highlighter | | `Ctrl/⌘ + Shift + Z` | Redo |
| `E` | Eraser | | Scroll / pinch | Zoom |
| `H` / hold `Space` | Pan | | Two-finger drag | Pan |

## 📱 Install on Android

Open the site in Chrome → menu **⋮** → **Add to Home screen**. It launches full-screen like a native app and works offline.

## 🛠 Tech

Plain HTML + CSS + vanilla JavaScript on a single `<canvas>`. No build step, no dependencies, no framework — just static files. Deployed on GitHub Pages.

## Running locally

```bash
# any static file server works
python -m http.server 8080
# then open http://localhost:8080
```

## License

MIT — do anything you like. Not affiliated with Endless Paper.
