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
// The worker predicts a longer stretch of decisions internally and sends
// only the next second of it whenever the plan changes.
//
// anchor (main -> worker):
//   {
//     type, revision,
//     map,              // map definition; edges serialized as an array
//     searchContext,    // live characters, pellets, lives, time, deathMode,
//                       // controlledPlayerIndex, ...
//     readyGhostIndices,
//     readyPlayerIndices // every Pac-Man that has to decide right now
//   }
//
// plan (worker -> main):
//   {
//     type, mapId, revision, complete, first,
//     plan: [
//       {
//         id, parent, choice,        // choice: the human action that led here
//         actor: "ghost" | "player",
//         playerIndex,               // deciding Pac-Man, -1 for a ghost node
//         action: null | { ghostDirections?: [[index, { x, y }]],
//                          playerIndex?: number,
//                          playerDirection?: { x, y } },
//         choices: null | [{ direction: { x, y }, child: id }],
//         child: null | id,
//         time,                      // game seconds since the anchor
//         view                       // the frame the main thread renders
//       }
//     ]
//   }
//
// `view` is the state of the actors at `time`, so the main thread can play
// the game by following the plan instead of simulating it: it interpolates
// each actor between two nodes with the direction and the progress it reads
// here, and never runs the event queue, the collisions or the decisions.
// The arrays are positional on purpose: the plan is sent again on every
// anchor and the payload sits on the latency-critical path.
//
//   players: [[x, y, dx, dy, progress, lives, invincibleTimer]]
//   ghosts:  [[x, y, dx, dy, progress, frightened, frightenedTimer, eaten]]
//   eaten:   ["x,y"]   pellets the transition into this node ate
//
// A node is a step of the search, so the transition into it is one event:
// `eaten` normally holds one cell, and `lives`/`terminal` say whether the
// step cost a life or ended the level. The root node carries the anchored
// state itself and an empty `eaten`.
//
// The plan is a tree of decisions: every actor decides in its own node,
// the AI decision is taken once, and only the human-controlled character
// branches, so the main thread follows the branch that matches the
// player's actual choices. One Pac-Man decides per player node; the
// companions are automated and carry a single action like the ghosts.

const STRATEGY_BUFFER_MESSAGE = Object.freeze({
    anchor: "anchor",
    plan: "plan",
    error: "error"
});

// How far ahead, in game seconds, the worker sends decisions.
const STRATEGY_PLAN_HORIZON_SECONDS = 1;

// How far ahead, in game seconds, the worker builds the plan internally.
// The extra span is a temporal cushion for the search: the RBFM walk stays
// random while it is inside the plan and only starts the improve/worsen
// alternation when it leaves it, so the internal plan is one transmitted
// plan longer than what the main thread receives.
const STRATEGY_PLAN_INTERNAL_HORIZON_SECONDS =
    STRATEGY_PLAN_HORIZON_SECONDS * 2;
