# Tarneeb · Trix · Trix Complex

A card-game app (web + mobile, AI + online) for **Tarneeb**, **Trix**, and **Trix Complex**.
Built as a TypeScript monorepo around a pure, framework-agnostic rules engine.

> Design sources live alongside this code: `Tarneeb game rules.docx`, `Trix Game Rules.docx`,
> `Tarneeb situations.docx`, `Trix use cases.docx`, `Trix complex use cases.docx`, the
> `Images/` mockups, and `Tarneeb_Trix_Rules_and_Strategy.pdf` (the consolidated rules +
> bot-strategy contract). **The rules doc is the authoritative build contract.**

## Architecture

```
packages/
  engine/   Pure TypeScript, zero dependencies. Cards, deal, and the full
            Tarneeb state machine (bidding → trump → 13 tricks → scoring).
            One source of truth for the rules; reused by UI, AI, and server.
  ai/       Rule-based bots implementing the B1 / T1–T11 / D1–D2 playbook:
            card counting, void inference, trump drawing, partnership signals.
            knowledge.ts = public-info inference; play.ts = tactics; bot.ts = bidding + entry.
apps/
  web/      (next) React + TypeScript (Vite). Responsive table UI, PWA-installable
            so it also runs in mobile browsers.
  server/   (later) Node + WebSockets for online multiplayer.
  mobile/   (later) Expo / React Native, reusing engine + shared React code.
```

## Roadmap

1. **Tarneeb vs AI (single-player), end-to-end** ← playable
   - [x] Engine: cards, deterministic shuffle, bidding, trump, trick play, scoring
   - [x] Web UI: table, hand, bidding & trump modals, scoreboard, hand/game overlays (Arabic + English, RTL)
   - [x] AI: full playbook — B1 bidding + T1–T11 / D1–D2 play on a card-counting /
     void-inference / outstanding-card layer (`packages/ai`: `knowledge.ts` + `play.ts`).
     Wins 100% vs random over 200 games; unit-tested per tactic.
2. Online multiplayer (server + matchmaking + "play with friends")
3. Trix + Trix Complex (regular / kingdoms / contracts, individual & partnership)
4. Mobile app packaging

## Where the code lives

- **Working repo (source of truth): `C:\Projects\tarneeb-trix`** — outside Google
  Drive, because `npm install`/builds generate tens of thousands of files in
  `node_modules` that Drive's sync client locks (causing `EBADF`/`ENOTEMPTY`).
- **Drive mirror: `G:\My Drive\Projects\Card Game app\tarneeb-trix`** — a
  code-only copy for backup/access, kept in sync by `scripts/sync-to-drive.ps1`
  (it excludes `node_modules`, `dist`, `coverage`, `.git`). Design docs + `Images/`
  stay in the `Card Game app` root. **Always edit in the C:\ repo, then sync.**

```powershell
# After making changes, mirror the repo to Drive:
powershell -File C:\Projects\tarneeb-trix\scripts\sync-to-drive.ps1
```

## Prerequisites

- **Node.js** is installed at `C:\Program Files\nodejs` (v24). If `node`/`npm`
  aren't found in a shell, that shell just hasn't picked up PATH — prepend it:
  `$env:Path = "C:\Program Files\nodejs;" + $env:Path`.

## Getting started

```bash
npm install                  # install workspace dev deps (from C:\Projects\tarneeb-trix)
npm run dev -w @tarneeb/web  # play Tarneeb vs 3 bots at http://localhost:5173
npm test                     # run the engine's test suite (Vitest) — 18 tests
npm run typecheck            # type-check all workspaces
npm run build                # production build of the web app
```

You play the bottom seat; the other three are bots. Bid or pass, name trump if
you win the bid, then click a highlighted card to play. Toggle Arabic/English
from the top bar.

## Engine quick tour

```ts
import { createGame, applyAction, getLegalActions } from '@tarneeb/engine';

let state = createGame({ seed: 42 });        // deals hand 0, phase 'bidding'
const actions = getLegalActions(state);       // legal actions for the seat on turn
state = applyAction(state, actions[0]);       // pure reducer: (state, action) -> state
```

`applyAction` is a pure function and throws on illegal moves (the engine is
authoritative). UI and bots both drive the game only through `getLegalActions` +
`applyAction`, so the rules can never be bypassed.

## Notes / rule assumptions

- Play and the deal rotate **counter-clockwise** (to the right); `nextSeat(s) = (s+1)%4`.
  Partners face each other: team 0 = seats 0 & 2, team 1 = seats 1 & 3.
- **All-pass in bidding → throw-in / redeal**, with the deal moving one seat right.
  (The rules doc doesn't specify the all-pass case; this is the chosen convention —
  flag if you'd prefer a forced minimum bid on the dealer instead.)
- Game ends when a team reaches a cumulative **31+**.
