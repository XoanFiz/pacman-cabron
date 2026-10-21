// ============================================================
// STRATEGY BUFFER PROTOCOL
// ============================================================
//
// Threads:
//
//   main thread (main.js bridge / strategy.js)
//     --anchor-->  worker (strategy-worker.js)
//     <--buffer--  worker
//
// The main thread never waits for the worker: it looks a decision up by
// state key and falls back to the local search when the buffer misses.
// The worker predicts the decisions of the next second and sends the
// entries whenever the buffer changes.
//
// anchor (main -> worker):
//   {
//     type, revision,
//     map,              // map definition; edges serialized as an array
//     searchContext,    // live characters, pellets, lives, time, ...
//     readyGhostIndices,
//     readyPlayer
//   }
//
// buffer (worker -> main):
//   {
//     type, mapId, revision, complete,
//     entries: [
//       {
//         key,                 // buildStateKey of the decision state
//         ghostDirections?: [[index, { x, y }]],
//         playerDirection?: { x, y }
//       }
//     ]
//   }
//
// Only the human-controlled character branches: the buffer explores every
// legal decision the player can take, so a hit does not depend on the
// player following the search's preferred line.

const STRATEGY_BUFFER_MESSAGE = Object.freeze({
    anchor: "anchor",
    buffer: "buffer",
    error: "error"
});

// How far ahead, in game seconds, the worker predicts decisions.
const STRATEGY_BUFFER_HORIZON_SECONDS = 1;

// Hard cap on stored decision states. Entries are consumed by key, so the
// cap only bounds memory and clone time.
const STRATEGY_BUFFER_MAX_ENTRIES = 64;
