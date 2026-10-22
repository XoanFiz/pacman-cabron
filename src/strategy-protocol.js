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
// The main thread never waits for the worker: it follows a cursor over
// the plan and falls back to a cheap decision when the plan has no node.
// The worker predicts the decisions of the next second and sends the plan
// whenever it changes.
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
// plan (worker -> main):
//   {
//     type, mapId, revision, complete,
//     plan: [
//       {
//         id, parent, choice,        // choice: the human action that led here
//         actor: "ghost" | "player",
//         action: null | { ghostDirections?: [[index, { x, y }]],
//                          playerDirection?: { x, y } },
//         choices: null | [{ direction: { x, y }, child: id }],
//         child: null | id
//       }
//     ]
//   }
//
// The plan is a tree of decisions: the AI decision is taken once, and only
// the human-controlled character branches, so the main thread follows the
// branch that matches the player's actual choices.

const STRATEGY_BUFFER_MESSAGE = Object.freeze({
    anchor: "anchor",
    plan: "plan",
    error: "error"
});

// How far ahead, in game seconds, the worker predicts decisions.
const STRATEGY_PLAN_HORIZON_SECONDS = 1;

// Hard cap on plan nodes; the cap only bounds the plan size and clone time.
const STRATEGY_PLAN_MAX_NODES = 64;
