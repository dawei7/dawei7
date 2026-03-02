# Bible Reader · Smart Search

A Next.js 15 + Tailwind v4 rebuild of [BibleReader_SmartSearch](https://github.com/dawei7/BibleReader_SmartSearch).

## Features

- **Read mode** — navigate books, chapters, and verse ranges with TTS support
- **Smart Search** — all-words / any-word / phrase modes with match statistics and bar charts
- **Prophecy tracker** — browse prophecy & fulfillment data from `public/prophecies.json`
- **Dark mode** — system / light / dark themes persisted to localStorage
- **Settings** — font size, font family, line height, reader width, verse layout, etc.
- **PWA-ready** — `manifest.json` included for home-screen installation

## Stack

- [Next.js 15](https://nextjs.org/) with App Router
- [Tailwind CSS v4](https://tailwindcss.com/)
- [framer-motion](https://www.framer-motion.com/) for animations
- [recharts](https://recharts.org/) for search statistics

## Getting started

```bash
cd apps/bible-reader
npm install
npm run dev
# → http://localhost:3000
```

## Bible data

Place Bible JSON files under `public/bibles/`:

```
public/
  bibles/
    index.json          ← version catalog (required)
    en_kjv.json         ← Bible JSON array
    de_schlachter.json
    ...
```

**`index.json`** format:

```json
[
  {
    "language": "English",
    "versions": [{ "name": "King James Version", "abbreviation": "en_kjv" }]
  }
]
```

**Version file** format (`en_kjv.json`):

```json
[
  { "name": "Genesis", "abbrev": "Gen", "chapters": [["Verse 1", "Verse 2"], ...] },
  ...
]
```

## Prophecy data

Optional. Place a JSON array at `public/prophecies.json`:

```json
[
  {
    "id": 1,
    "title": "The Messiah born of a virgin",
    "prophecyRef": "Isaiah 7:14",
    "fulfillment": { "biblicalRef": "Matthew 1:22-23" },
    "summary": "..."
  }
]
```

## Docker

```bash
docker build -t bible-reader .
docker run -p 3000:3000 bible-reader
```
