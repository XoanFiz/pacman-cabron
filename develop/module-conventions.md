# Module and thread conventions

This note describes how the files under `src/` are expected to be
organised. It exists because the project has no bundler and therefore no
import graph: every file is a script that defines globals, and the load
order is the wiring. The conventions below keep that wiring explicit.

## 1. One factory per file

Each file defines exactly one public factory:

```js
function createThing({ dependencyA, dependencyB = defaultB } = {}) {
    // private helpers...
    return { publicFunctionA, publicFunctionB };
}
```

Rules:

- Name the factory `createXxx` and return a plain object with the public
  API. Do not export private helpers or mutable internals.
- Dependencies come in through the `parameters` object. Destructure them
  explicitly at the top of the factory.
- Validate required dependencies and throw `TypeError` / `RangeError`
  with a message that names the missing item. Never fail with
  "undefined is not a function" deep in an algorithm.
- No module reads or writes `globalThis` (or any other global) after
  creation. Globals are only the mechanism the page uses to load the
  factories themselves.
- Game-specific knowledge stays out of generic modules. `strategy`,
  `randomized-best-first-minimax` and `calibration/runner` must not know
  about Pac-Man; they receive behaviour through adapters.
- Each factory starts with a header comment stating: purpose, inputs,
  returned API and who calls it.

## 2. Thread boundaries

There are three boundaries in the calibration path, and only one of them
crosses threads:

| Boundary | Mechanism | Notes |
| --- | --- | --- |
| `map.js` (main) <-> `calibration/worker.js` | `postMessage` | Crosses threads. Structured clone. No shared memory, no shared globals. |
| `calibration/worker.js` <-> `calibration/runner.js` | function calls | Same thread. The worker injects the adapters; the runner returns data. |
| `calibration/runner.js` <-> `strategy` / RBFM | adapters | Same thread. Injected by the worker. |

Rules:

- A worker global is private to the worker. Assigning helpers to
  `globalThis` inside a worker does not reach the main thread and is not
  a substitute for arguments.
- The only cross-thread contract is the message protocol, declared in
  `calibration/protocol.js`: message types, default options, option
  normalisation and documented `status` / `result` shapes. Both sides
  must import it and use its constants instead of string literals.
- Payloads must be structured-cloneable: no functions, no class
  instances. `Set` is allowed.
- The sender is responsible for a payload that satisfies the documented
  shape; the receiver normalises/validates it at the boundary.

## 3. What lives where

- `main.js`, `state.js`, `map.js`, `rules.js`, `renderer.js`, `ui.js`,
  `editor.js`, `input.js`, `runtime.js`, `ai-controller.js`, `bindings.js`:
  page/DOM/thread orchestration. They may use the DOM.
- `strategy`, `randomized-best-first-minimax`, `map-geometry`, `model`:
  pure algorithms and data structures. No DOM.
- `calibration/runner`: generic calibration engine. No Pac-Man, no DOM,
  no worker API.
- `calibration/worker`: adapter only. Restore request, build strategy,
  expose adapters, drive the runner, report messages.
- `calibration/protocol`: shared contract, loaded by both threads.

## 4. Checklist for a new module

1. Does it need a thread? If yes, it is a worker: adapter + protocol only.
2. List its dependencies and pass them as parameters; no globals.
3. Write the header comment before the code.
4. Validate the dependencies at creation time.
5. If it crosses a thread, add the messages to `calibration/protocol.js` and use its constants on both sides.
6. Add it to `main.js` only if the page needs it; a worker-only module
   belongs in the worker's `importScripts`.

## 5. Persisted strategy data

Two independent versions guard what is stored in IndexedDB:

- `CALIBRATION_VERSION` (`calibration/protocol.js`) versions the
  calibration payload: sample shape, options and the meaning of `f`/`g`.
  Bump it when that payload or its interpretation changes; maps with
  another version are recalibrated.
- `STRATEGY_VERSION` (`strategy-version.js`) versions the search
  convention: state keys, available decisions and node/value meaning.
  Bump it when a persisted graph or value table would no longer be valid;
  records from another version are discarded.

Write both versions into the records you persist in IndexedDB and check
them before using a record. Never reuse a graph or a value table written
by another search convention, even if the map and the calibration match.
