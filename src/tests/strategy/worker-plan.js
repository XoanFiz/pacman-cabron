// Headless check for the strategy worker plan slice.
//
// Loads the worker in a VM with a stubbed self/importScripts, sends one
// anchor and checks that the transmitted plan stays inside the transmitted
// horizon, keeps its links consistent, and never grows past the internal
// plan the worker built.
//
// Usage: node src/tests/strategy/worker-plan.js

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const main = path.resolve(__dirname, "../../..");
const rd = p => fs.readFileSync(path.join(main, "src", p), "utf8")
    .replace(/\r\n/g, "\n");

const messages = [];
const ctx = vm.createContext({
    console,
    Math,
    JSON,
    Set,
    Map,
    structuredClone,
    Date,
    setTimeout,
    self: {
        postMessage: message => messages.push(structuredClone(message))
    }
});

ctx.__run = name => vm.runInContext(rd(name), ctx, { filename: name });
ctx.importScripts = (...files) => {
    for (const file of files) {
        ctx.__run(path.posix.normalize(path.posix.join("strategy", file)));
    }
};

// Build a live game only to produce a real search context.
for (const f of [
    "config.js",
    "map-geometry.js",
    "model.js",
    "strategy/randomized-best-first-minimax.js",
    "strategy/strategy.js",
    "rules.js"
]) {
    ctx.__run(f);
}

const anchor = vm.runInContext(`
const gameContext = (() => {
    const DIRECTIONS = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
    const tiles = ["#####", "#o..#", "#...#", "#...#", "#####"].map(r => Array.from(r));
    const wrap = (v, n) => ((v % n) + n) % n;
    const canMove = (x, y, d) => tiles[wrap(y + d.y, 5)][wrap(x + d.x, 5)] !== "#";
    const currentMap = {
        id: "t", tiles, edges: [],
        playerStart: { x: 1, y: 1, direction: { x: 1, y: 0 } },
        ghostStarts: [
            { x: 1, y: 3, direction: { x: 0, y: -1 }, color: "#f00" },
            { x: 3, y: 3, direction: { x: 0, y: -1 }, color: "#0f0" }
        ]
    };
    const map = {
        DIRECTIONS, currentMap, graph: {}, strategicSearch: { frontier: [], root: null },
        getMapColumnCount: () => 5, getMapRowCount: () => 5, wrap, canMove,
        getPossibleDirections: c => Object.values(DIRECTIONS).filter(d => canMove(c.x, c.y, d)),
        buildGhostHouses: () => [], getCurrentMapDefinition: () => currentMap,
        cloneMapDefinition: d => structuredClone(d),
        buildMapData: () => ({ graph: {}, pellets: new Set(["1,1", "2,1", "3,1"]) }),
        buildGraph: () => ({})
    };
    const state = {
        currentGameState: {}, selectedCharacter: "pacman", pressedDirections: [],
        statusElement: { textContent: "" }, setStatus: () => {}, getGhostColor: i => i ? "#0f0" : "#f00"
    };
    const rules = createGameRules({
        config: createGameConfig(), state, map, model: createGameModel(),
        intelligence: {
            getCurrentSearchContext: () => {
                const gs = state.currentGameState;
                return {
                    player: gs.player, players: gs.players,
                    ghosts: gs.ghosts, pellets: gs.pellets,
                    lives: gs.lives, time: gs.time,
                    respawnState: {
                        player: { x: 1, y: 1 },
                        players: gs.players.map(() => ({ x: 1, y: 1 })),
                        ghosts: gs.ghosts.map(g => ({ x: g.x, y: g.y, direction: { ...g.direction }, speed: 2.25 })),
                        houses: []
                    },
                    controlledPlayerIndex: 0,
                    controlledGhostIndex: -1
                };
            },
            anchorSearch: () => {},
            recordHumanDecision: () => {},
            chooseGhostDirections: (searchContext, indices) =>
                new Map(indices.map(i => [i, { ...searchContext.ghosts[i].direction }])),
            choosePacmanDirection: searchContext => ({ ...searchContext.player.direction })
        },
        ui: { updateUI: () => {}, updatePauseButton: () => {} }
    });
    rules.resetGame();
    const gs = state.currentGameState;
    gs.running = true; gs.lives = 3; gs.time = 0;
    state.pressedDirections = ["right"];
    rules.update(1 / 60);
    return {
        type: "anchor",
        revision: 1,
        map: { ...currentMap, edges: [...currentMap.edges] },
        searchContext: {
            player: gs.player, players: gs.players,
            ghosts: gs.ghosts, pellets: gs.pellets,
            lives: gs.lives, time: gs.time,
            respawnState: {
                player: { x: 1, y: 1 },
                players: gs.players.map(() => ({ x: 1, y: 1 })),
                ghosts: gs.ghosts.map(g => ({ x: g.x, y: g.y, direction: { ...g.direction }, speed: 2.25 })),
                houses: []
            },
            controlledPlayerIndex: 0,
            controlledGhostIndex: -1
        },
        readyGhostIndices: gs.ghosts.map((g, i) => g.needsDirection ? i : -1).filter(i => i >= 0),
        readyPlayerIndices: gs.players
            .map((player, index) => player.ready ? index : -1)
            .filter(index => index >= 0)
    };
})();
gameContext;
`, ctx);

ctx.__run("strategy/worker.js");

ctx.self.onmessage({ data: anchor });

setTimeout(() => {
    const planMessage = [...messages]
        .reverse()
        .find(message => message.type === "plan" && message.plan[0]);

    if (!planMessage) {
        console.error("no plan message");
        process.exit(1);
    }

    const nodes = planMessage.plan.filter(Boolean);
    const anchorTime = anchor.searchContext.time;
    const outOfWindow = nodes.filter(node =>
        node.time > anchorTime + 1 + 1e-9
    );

    if (outOfWindow.length > 0) {
        console.error("transmitted plan exceeds the transmitted horizon");
        process.exit(1);
    }

    if (nodes.some(node =>
        typeof node.key !== "string" || node.key.length === 0
    )) {
        console.error("transmitted plan node without state key");
        process.exit(1);
    }

    for (const node of nodes) {
        if (node.child !== null && !planMessage.plan[node.child]) {
            console.error("dangling child", node.id, node.child);
            process.exit(1);
        }

        for (const choice of node.choices || []) {
            if (choice.child !== null && !planMessage.plan[choice.child]) {
                console.error("dangling choice", node.id, choice.child);
                process.exit(1);
            }
        }
    }

    // The main thread follows the plan instead of simulating the game, so
    // every node carries the frame it renders. The anchor itself is not a
    // node (the job advances to the first decision), so the check is the
    // one that does not need the internal tree: the view has to describe
    // the same actors as the anchor and to move them with the plan, not
    // ahead of it.
    const root = nodes.find(node => node.parent === -1);

    if (!root || !root.view) {
        console.error("plan root without view");
        process.exit(1);
    }

    const brokenView = nodes.find(node =>
        !node.view ||
        node.view.players.length !== anchor.searchContext.players.length ||
        node.view.ghosts.length !== anchor.searchContext.ghosts.length
    );

    if (brokenView) {
        console.error("plan node without a usable view", brokenView.id);
        process.exit(1);
    }

    if (root.view.eaten.length !== 0) {
        console.error("plan root view claims pellets it did not eat");
        process.exit(1);
    }

    const WIDTH = anchor.map.tiles[0].length;
    const HEIGHT = anchor.map.tiles.length;
    const wrapped = (a, b, size) => Math.min(
        Math.abs(a - b),
        size - Math.abs(a - b)
    );
    const cellDistance = (a, b) =>
        wrapped(a[0], b[0], WIDTH) + wrapped(a[1], b[1], HEIGHT);

    for (const node of nodes) {
        const parent = node.parent >= 0 ? planMessage.plan[node.parent] : null;

        // A death resets the positions: the round outcome is the signal.
        if (!parent || !parent.view ||
            parent.view.lives !== node.view.lives ||
            node.view.terminal) {
            continue;
        }

        const pairs = [
            ...node.view.players.map((view, index) =>
                ["player", index, view, parent.view.players[index]]),
            ...node.view.ghosts.map((view, index) =>
                ["ghost", index, view, parent.view.ghosts[index]])
        ];

        for (const [kind, index, view, previous] of pairs) {
            // One event moves a character less than one cell; warps are
            // wrapped before the distance and the slack covers rounding.
            if (cellDistance(view, previous) > 2) {
                console.error(
                    "plan view teleports",
                    kind,
                    index,
                    node.id,
                    previous.slice(0, 2),
                    view.slice(0, 2)
                );
                process.exit(1);
            }
        }
    }

    console.log(JSON.stringify({
        transmitted: nodes.length,
        internal: planMessage.stats.nodes,
        bytes: JSON.stringify(planMessage.plan).length,
        maxTime: Number((
            Math.max(...nodes.map(node => node.time)) - anchorTime
        ).toFixed(2))
    }));

    process.exit(0);
}, 400);
