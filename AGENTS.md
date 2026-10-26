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
- Plan latency: `node develop/plan-latency.js restart left 40` plays a
  two-Pac-Man game with the real worker and prints the plan hits, misses
  and the miss reasons; use it to measure a plan pipeline change.

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
- When you commit, update the "Current state" section below and keep the
  developer's branch pointing at that commit (see the session integration
  rules). Write the message in the project style: imperative subject, a
  blank line, the body with the why, a blank line and `Code changes:`
  bullets naming the files.
- This session may run in a git worktree (`.dsh-worktrees/<id>/`, branch
  `dsh/<id>`) while the developer works on
  `chatgpt-search-engine-refactor0` in the main checkout. Resolve every
  path against the session worktree: an absolute path without its prefix
  edits the developer's checkout, not the worktree.
- The session tooling integrates the worktree into the developer's branch
  when the turn ends. It commits uncommitted changes as `Session <id>
  worktree changes` and merges a diverged session branch as `Merge
  session <id>`, both with the same tree as the real work, so the
  descriptive commit can end up under a generic tip. Keep the worktree
  clean and, before ending a turn (or as soon as the developer says a
  commit is missing), check `git -C <main checkout> log`. If the branch
  is not at the session tip but its tree is the same (`git diff --stat`
  is empty), move it forward to the session tip (`git -C <main> merge
  --ff-only dsh/<id>`); the integration then stays a fast-forward and
  the descriptive commits are the last ones. Do it only with a clean main
  checkout and identical trees, and never rewrite the developer's older
  commits.

## Current state

- Branch `chatgpt-search-engine-refactor0`. Recent feature commits:
  `44ce825` (the editor removes ghosts), `7d5ee6d` (the plan carries a
  short state key) and `e20018e` (a map carries several Pac-Mans).
- Multiple Pac-Mans work end to end: the editor adds and removes them,
  the start screen lets the human pick one, each one has its own lives,
  and the map's death mode decides between resetting the positions and
  respawning the caught one untouchable. They move inside the event queue,
  so their arrivals and deaths share the timing of the other actors.
- Every Pac-Man is in the search. The state keeps the `players` list and a
  `readyPlayers` flag per player, the canonical key hashes all of them,
  each ready actor decides in its own node (the lowest ready index acts
  first, so a decision is never shared), and the plan names the deciding
  one with `playerIndex`. The heuristic is joint: the domain is the union
  of the Pac-Mans' reach, the danger and the prey are the worst threat and
  the best frightened ghost any of them sees, and the pellet gradient is
  the nearest pellet over the whole team. The lives are a shared pool that
  counts the per-player counters, and a Pac-Man with no lives left stays
  in the list (the plan refers to it by index) but stops moving and
  deciding. Companions decide through the search like an automated player;
  the pellet-chasing policy is gone. The domain labels each Pac-Man's
  territory with its index (`pacman`, `pacman1`, `pacman2`...): the search
  keeps reading all of them as Pac-Man territory and the Voronoi view
  paints each one with its own colour.
- The search models the map's death mode. With `restart` the catch resets
  every living Pac-Man and every ghost; with `respawn` only the caught
  Pac-Man goes back to its start, keeps the others playing, and carries an
  `invincibleTimer` window that the canonical key sees, that ends as an
  event and that keeps it out of the danger term while it lasts. The
  invincibility comes from the live `invincibleUntil` and becomes a
  relative timer in the state, like a ghost's frightened timer. The state,
  the transitions and the heuristic changed, so `CALIBRATION_VERSION` is 8
  and every map is calibrated again.
- The plan pipeline is latency bound: the worker posts the first view of a
  new anchor and the main thread follows it by state key. With several
  actors every second has more decision levels, so `getTransmittedPlan`
  expands with `PLAN_VIEW_EXPAND_MILLISECONDS = 20` (8 ms reached less than
  the transmitted second in a two-Pac-Man game and left decisions without
  an action) and the main thread keeps the newest non-empty plan even when
  the cursor cannot be placed in it: the next decision seeks its node by
  key, and an older stored plan is not better. A plan log with
  `key-not-found` or `no-action` means the view ran out (raise the budget)
  or arrived after the game moved on (look at the anchor rate).
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
