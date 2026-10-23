// Headless check of the distributed exploration tree: two replicas, one
// expansion broadcast, values bubbling across owners, the plan view and the
// root advance that drops the branches that were not taken.
//
// Usage: node src/tests/strategy/tree-registry.js

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const main = path.resolve(__dirname, "../../..");
const source = fs
    .readFileSync(
        path.join(main, "src", "strategy", "tree-registry.js"),
        "utf8"
    )
    .replace(/\r\n/g, "\n");

const ctx = vm.createContext({ console, Math, JSON, Set, Map });
vm.runInContext(source, ctx, { filename: "tree-registry.js" });

vm.runInContext(`
function expect(label, condition) {
    if (!condition) {
        throw new Error("FAIL: " + label);
    }
}

const operations = [];
let first = null;
let second = null;

first = createGameTreeRegistry({
    workerId: 0,
    controlledGhostIndex: -1,
    onBroadcast: operation => {
        operations.push(operation);
        second && second.apply(operation);
    }
});
second = createGameTreeRegistry({
    workerId: 1,
    controlledGhostIndex: -1,
    onBroadcast: operation => {
        operations.push(operation);
        first && first.apply(operation);
    }
});

const root = {
    key: "R",
    parent: null,
    time: 0,
    actor: "player",
    playerControlled: true,
    value: 0,
    owner: 0,
    revision: 0,
    expanded: false,
    children: []
};

first.createNode(root);
second.apply({ type: TREE_OPERATION.node, node: root });
first.setRoot("R");
second.setRoot("R");

const leftAction = { ghostDirections: [], playerDirection: { x: -1, y: 0 } };
const rightAction = { ghostDirections: [], playerDirection: { x: 1, y: 0 } };

first.expand("R", [
    {
        key: "C1", time: 0.2, actor: "ghost", playerControlled: false,
        value: 5, action: leftAction, owner: 0
    },
    {
        key: "C2", time: 0.3, actor: "ghost", playerControlled: false,
        value: 3, action: rightAction, owner: 1
    }
]);

expect("the expansion reached the replica", second.get("R").expanded === true);
expect("the assigned child owners were kept", second.get("C2").owner === 1);

function ghostAction(index, direction) {
    return {
        ghostDirections: [[index, direction]],
        playerDirection: null
    };
}

first.expand("C1", [
    {
        key: "G1", time: 0.4, actor: "player", playerControlled: true,
        value: 2, action: ghostAction(0, { x: 0, y: -1 })
    },
    {
        key: "G2", time: 0.5, actor: "player", playerControlled: true,
        value: 6, action: ghostAction(0, { x: 0, y: 1 })
    }
]);

expect("the expanded node was recalculated", second.get("C1").value === 6);
expect("the parent was recalculated by its owner", second.get("R").value === 3);

second.expand("C2", [
    {
        key: "H1", time: 0.45, actor: "player", playerControlled: true,
        value: 4, action: ghostAction(1, { x: -1, y: 0 })
    },
    {
        key: "H2", time: 0.55, actor: "player", playerControlled: true,
        value: 1, action: ghostAction(1, { x: 1, y: 0 })
    }
]);

expect("the cross-owner bubble reached the root", first.get("R").value === 4);
expect(
    "both replicas agree",
    first.get("R").value === second.get("R").value &&
    first.size() === second.size()
);

const plan = second.buildPlan(1);
const rootPlan = plan[0];

expect("the player decision branches", rootPlan.choices.length === 2);
expect("the plan has the node of each branch", plan.filter(Boolean).length === 5);

const leftPlan = plan[rootPlan.choices[0].child];
const rightPlan = plan[rootPlan.choices[1].child];

expect("the left branch is C1", leftPlan.time === 0.2);
expect("the right branch is C2", rightPlan.time === 0.3);
expect(
    "the computer decision takes the best child",
    leftPlan.action.ghostDirections[0][1].y === 1
);

first.setRoot("C1");
second.setRoot("C1");

expect("the untaken branch was dropped", second.get("C2") === null);
expect(
    "the taken subtree was kept",
    second.get("G1") !== null && second.get("G2") !== null
);
expect("both replicas kept the same nodes", first.size() === second.size());
expect(
    "the plan starts at the taken branch",
    second.buildPlan(1)[0].time === 0.2
);
expect("a node is not expanded twice", first.expand("C1", []) === false);
expect(
    "the plan nodes carry their state key",
    leftPlan.key === "C1" && rightPlan.key === "C2"
);

console.log("tree registry ok", JSON.stringify({
    operations: operations.length,
    nodes: second.size()
}));
`, ctx);
