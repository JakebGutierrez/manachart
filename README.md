# Mana Chart

A Topster-style collage builder for **Magic: The Gathering** card art. Search
[Scryfall](https://scryfall.com) or paste a decklist, arrange the art into a grid,
then export a PNG or share your chart with a link.

**Live: [manachart.app](https://manachart.app)**

![Mana Chart screenshot](design/Screenshot%202026-06-21%20at%203.45.35%20pm.png)

## Features

- **Scryfall search** — add cards by name; full Scryfall query syntax works.
- **Decklist import** — paste an MTGO/Arena/Moxfield-style list and auto-fill the grid.
- **Flexible grids** — resizable rows/cols, landscape or square cells, and a hybrid
  hero layout for commanders.
- **Arrange** — drag to reorder, sort by type/CMC/colour, or shuffle.
- **Per-card framing** — pick alternate printings, flip double-faced cards, and crop.
- **Custom slots** — drop in your own images alongside card art.
- **Export** — high-resolution PNG rendered client-side via canvas.
- **Share links** — the whole chart is encoded into a URL; no account needed.
- **Local-first** — multiple charts persist in your browser; nothing is sent to a server.

## Development

```bash
npm run dev     # start the Vite dev server
npm run build   # tsc -b && vite build
npm run lint    # eslint
npm run test    # vitest run
```

`npm run build && npm run lint && npm run test` is the full correctness gate — all
three must pass before every commit.

## Attribution

Card data and images provided by [Scryfall](https://scryfall.com). Cards © Wizards
of the Coast. This project is not affiliated with or endorsed by Scryfall or Wizards
of the Coast.
