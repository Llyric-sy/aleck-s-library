# Aleck's Library

A lightweight, offline-first personal reading web app.

## Why this build
- Static HTML/CSS/JS: no framework or heavy runtime.
- Chapter-sized text assets: fast on weak reception.
- Service worker: caches the app and available books for offline reading.
- Local progress/bookmarks: saved in the browser.
- GitHub Pages friendly.

## Book packaging
Each book lives under `books/<slug>/` with:
- `metadata.json`
- `cover.webp`
- `chapters/001.json`, `002.json`, etc.

The catalog is `books/catalog.json`.

> Only add book text/files you have the right to host. The repository is currently public.

## Offline behaviour
On first load, the app caches the shell immediately and starts caching book chapter files in the background. Once a book is cached on a device, it remains readable without a usable connection.

Because a device cannot receive content it has never downloaded, a newly added book still needs one successful sync to that device. Splitting books into tiny chapter files makes that sync far more reliable on poor reception than downloading a full PDF/EPUB.
