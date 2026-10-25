# Agent guide

The entry point for automated agents and for anyone who needs the shape
of the project. Read this before searching the source.

The game is a static browser game: vanilla JavaScript, no bundler, no
package.json, no CI. `index.html` plus `src/` is the whole program.
`develop/developer-notes.txt` is the developer's own TODO and suggestion
list, and `develop/module-conventions.md` describes how the modules and
the threads are organised. Talk to the developer in Galician; code,
comments and commit messages in English.

## How to run it

- Game: open `index.html` in a browser, or serve the folder. There is no
  build step: `src/main.js` loads the scripts in order and calls
  `initializeGame()`, which exposes `window.PACMAN_GAME`.
- Tests: `node develop/run-tests.js` runs every test under `src/tests`
  and prints one summary line. `--fast` skips the tests that play games,
  `--only <text>` filters by path (for example `--only editor`), and
  `--timeout <seconds>` changes the limit per test.
- One test: every file under `src/tests` is a standalone script, so
  `node src/tests/editor/characters.js` also works.
- Benchmark: `node src/tests/strategy/bench.js --games 3 --walks 6
  --seed 7 --out tmp/bench.json`; the header of that file documents the
  flags. It plays real games, so it takes minutes.

## What lives where

| path | owns |
| --- | --- |
| `src/main.js` | script order, `initializeGame`, `window.PACMAN_GAME`, worker bridges |
| `src/config.js` | speeds, timings and the search weights (`SEARCH_VALUE_*`) |
| `src/state.js` | DOM references, translations, live game state, editor flags |
| `src/model.js` | player and ghost state constructors |
| `src/map.js` | map definitions, adjacency, pellets and ghost houses, character choices, calibration driver |
| `src/map-geometry.js`, `src/map-storage.js` | pure geometry helpers, IndexedDB access |
| `src/rules.js` | live simulation: `update(dt)`, event queue, lives, pellets, deaths and wins |
| `src/strategy/strategy.js` | search state, transitions, `evaluateSearchState` (the heuristic), the plan, `buildStateKey` |
| `src/strategy/randomized-best-first-minimax.js` | the RBFM search engine |
| `src/strategy/worker.js`, `src/strategy/protocol.js` | the plan producer thread and the message contract shared by both sides |
| `src/ai-controller.js` | attaches plans and human decisions to the live game |
| `src/calibration/*` | calibration engine, worker adapter and shared protocol |
| `src/renderer.js`, `src/ui.js`, `src/input.js` | canvas drawing, score and status, keyboard and touch |
| `src/editor.js` | map editor: tiles, walls, characters, ghost houses and ghosts |
| `src/runtime.js` | the game loop, pause/resume, calibration state |
| `src/bindings.js` | `createGameBindings` publisher; currently unused, `main.js` sets `window.PACMAN_GAME` itself |
| `src/locales.js`, `src/locales/<lang>.js` | picks the browser language and loads exactly one flat dictionary |

## Invariants to respect

- No imports: every file defines a factory and the load order in
  `src/main.js` (or the worker's `importScripts`) is the wiring. Follow
  `develop/module-conventions.md`.
- The heuristic is `evaluateSearchState` in `src/strategy/strategy.js`:
  ghosts maximise it and Pac-Man minimises it, and the weights are the
  `SEARCH_VALUE_*` constants in `src/config.js`. A weight change must
  keep `circuit.js`, `trap.js`, `pacman-avoid.js` and the benchmark
  moving in the right direction; a term that silences `circuit` by
  stopping Pac-Man from eating is not a fix.
- The plan is a view of a persistent RBFM tree. The worker sends plans
  and the main thread places them by `buildStateKey`; that key is a
  64-bit FNV-1a hash of the canonical state text and it must stay the
  only state comparison.
- Editor edits live in `map.editorDraftMap` and are copied out with
  `syncEditorDraftMap()`; the live game state is the authoritative one
  while editing. Ghost colours are the three `BASE_GHOST_COLORS` plus
  generated distinct hues, a removed ghost frees its colour for the next
  one, and `getGhostName` follows the colour, not the index.
- Locales have no fallback: exactly one `<lang>.js` is loaded, so a new
  message key must be added to every locale file (or reuse an existing
  key). Test English and one other language, not all of them.
- Persisted data: `CALIBRATION_VERSION` in
  `src/calibration/protocol.js` guards the calibration payload stored in
  the map definitions (`src/map-storage.js`, database version 4). Bump it
  when the payload or its meaning changes. `module-conventions.md` §5
  still mentions a `STRATEGY_VERSION` and a `strategy-version.js`: they
  no longer exist, there is no persisted search graph.

## Baselines and known failures

- Benchmark on the classic map (`--games 6 --walks 6 --seed 7`, 90 s per
  game): cleared ≈ 0.64 levels per game, deaths ≈ 0.3. The sparse map
  (`--pellets 40`) never clears a level, so navigation is the
  bottleneck, not the heuristic.
- `src/tests/strategy/circuit.js` expects 0/9 escapes and currently
  reports 2/9. Known, not a new regression.
- `src/tests/strategy/pacman-avoid.js` reports that the playout dies
  even when the chosen decision avoids the ghost. Known open issue about
  the search depth.
- About a third of the games do not clear a level within 180 s because
  Pac-Man oscillates. Known open issue.

## How to work here

- Search before reading: `grep` for the symbol and then read only the
  matching region (`read` with `offset`/`limit`). Do not read whole files
  to find one function, and after an edit verify only the touched
  region.
- Verify with `develop/run-tests.js`: `--fast` for editor, UI, rules or
  docs changes; the full run only when the strategy or the search is
  touched.
- Keep the useful tools in `develop/`, with a header comment saying what
  they are for; keep `src/tests` for the tests themselves.
- When you commit, update the "Current state" section below.

## Current state

- Branch `chatgpt-search-engine-refactor0`. Recent feature commits:
  `44ce825` (the editor removes ghosts), `7d5ee6d` (the plan carries a
  short state key) and `e20018e` (a map carries several Pac-Mans).
- Multiple Pac-Mans work end to end: the editor adds and removes them,
  the start screen lets the human pick one, each one has its own lives,
  the ones the human does not drive walk to the nearest pellet, eat and
  can be caught, and the map's death mode decides between resetting the
  positions and respawning the caught one untouchable. What is still
  missing is the search modelling every Pac-Man, so the ghosts only plan
  against the one the game follows.
- Open threads: navigation and oscillation (no level cleared), the
  `pacman-avoid` playout and the `circuit` escapes above.

## Agent rules

These were moved here from `develop/developer-notes.txt` so they live in
one place:

- Do not commit. Leave every change in the working tree, tell the
  developer what changed and which tests pass, and let them test it and
  commit. Run `git commit` only when the developer asks for a commit in
  that same message.
- Do not make changes while there are open questions or doubts on the
  table. Ask first and wait for the answer; never guess what the
  developer wants and implement the guess.
- Do not waste time checking every possible language. Test only English
  and one other, and keep every locale file structurally identical.
  Automate that check with a tool in `develop/`.
- After a change, check whether the request is a line in
  `develop/developer-notes.txt`; if it is, ask the developer to delete it
  and include the deletion in the commit and the commit message.
- After a change, check whether the developer edited
  `develop/developer-notes.txt` and mention that human change in the
  commit message.
- Do not override changes in the working tree without asking what to do
  with them.
- Add the relevant tests to `src/tests`.
- Do not pick a TODO or SUGGESTIONS item on your own; only when the
  developer asks.
- If a task is left mid-way, write it at the top of
  `develop/developer-notes.txt`; if a task is done, remove it there.
- Limit Playwright runs to save tokens: ask the developer to run them,
  or hand over a list of the tests to run.
- Commit style: imperative subject, blank line, body, blank line,
  `Code changes:` bullets naming the files. Stage explicit paths; never
  `git add -A`.
