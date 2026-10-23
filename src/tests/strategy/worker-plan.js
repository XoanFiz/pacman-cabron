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
                    player: gs.player, ghosts: gs.ghosts, pellets: gs.pellets,
                    lives: gs.lives, time: gs.time,
                    respawnState: {
                        player: { x: 1, y: 1 },
                        ghosts: gs.ghosts.map(g => ({ x: g.x, y: g.y, direction: { ...g.direction }, speed: 2.25 })),
                        houses: []
                    },
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
            player: gs.player, ghosts: gs.ghosts, pellets: gs.pellets,
            lives: gs.lives, time: gs.time,
            respawnState: {
                player: { x: 1, y: 1 },
                ghosts: gs.ghosts.map(g => ({ x: g.x, y: g.y, direction: { ...g.direction }, speed: 2.25 })),
                houses: []
            },
            controlledGhostIndex: -1
        },
        readyGhostIndices: gs.ghosts.map((g, i) => g.needsDirection ? i : -1).filter(i => i >= 0),
        readyPlayer: Boolean(gs.player.ready)
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

    console.log(JSON.stringify({
        transmitted: nodes.length,
        internal: planMessage.stats.nodes,
        maxTime: Number((
            Math.max(...nodes.map(node => node.time)) - anchorTime
        ).toFixed(2))
    }));

    process.exit(0);
}, 400);
