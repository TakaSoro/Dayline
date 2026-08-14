# Journal

A personal journal desktop app built with Rust and Tauri.
Write markdown entries, analyze them with Gemini to extract activities, and visualize your daily timeline.

## Features

- **Markdown journal entries** with live preview and image support
- **SQLite storage** for journals and extracted activities
- **Gemini analysis** — automatically categorizes things you did (Work, Health, Social, etc.)
- **Timeline visualization** with category filtering

## Prerequisites

- [Rust](https://rustup.rs/)
- [Node.js](https://nodejs.org/) (v18+)
- A [Gemini API key](https://aistudio.google.com/apikey) (for AI analysis)

## Setup

```bash
npm install
```

## Development

```bash
npm run tauri dev
```

## Build

```bash
npm run tauri build
```

## Usage

1. Click **New Entry** to start writing
2. Write in Markdown — use the **Image** button to insert photos
3. Click **Save** (or `Ctrl+S`)
4. Click **Analyze with AI** to extract activities (requires API key in Settings)
5. Open the **Timeline** tab to see your daily activities, filterable by category

## Tech Stack

- **Backend:** Rust, Tauri 2, SQLite (rusqlite)
- **Frontend:** TypeScript, Vite, Marked
- **AI:** Google Gemini API

## AI Acknowledgements

- Gemini
