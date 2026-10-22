// Headless check for the plan-aware RBFM walk.
//
// The tree is an infinite binary tree of "max" nodes. Every node has two
// children: "a" (value 10) and "b" (value 0), both taking one second. With
// a zero standard deviation the random child inside the plan is always the
// best one ("a").
//
// - Inside the plan the walk descends with random children and does not
//   alternate, so it follows the best chain.
// - Leaving the plan on the best child starts "worsen": the next child is
//   sampled at random instead of taking the first one.
// - Without a plan the old rule applies: leaving the best child starts
//   "improve", so the walk keeps taking the first child.
//
// Usage: node src/tests/strategy/rbfm-plan-walk.js

const fs = require("fs");
const path = require("path");

const main = path.resolve(__dirname, "../../..");
const source = fs
    .readFileSync(
        path.join(main, "src", "strategy", "randomized-best-first-minimax.js"),
        "utf8"
    )
    .replace(/\r\n/g, "\n");
const createRbfm = new Function(
    source + "\nreturn createRandomizedBestFirstMinimax;"
)();

function createSearch() {
    const rbfm = createRbfm({
        getNodeType: () => "max",
        createSuccessorIterator: state => {
            const transitions = [
                {
                    state: { label: state.label + "a" },
                    value: 10,
                    duration: 1,
                    action: "a"
                },
                {
                    state: { label: state.label + "b" },
                    value: 0,
                    duration: 1,
                    action: "b"
                }
            ];
            let index = 0;
            return {
                next: () => index < transitions.length
                    ? { done: false, value: transitions[index++] }
                    : { done: true, value: undefined }
            };
        },
        getDistribution: node => ({
            mean: node.value,
            standardDeviation: 0
        })
    });

    rbfm.setRoot({ label: "" }, 0, 0);

    return rbfm;
}

const random = Math.random;
Math.random = () => 0.99;

let failures = 0;
function check(label, actual, expected) {
    if (actual !== expected) {
        failures++;
        console.error(`FAIL ${label}: expected ${expected}, got ${actual}`);
    }
}

try {
    const plan = createSearch();

    check("plan root", plan.rootDecision(0, 10).expandedNode.state.label, "");
    check("plan 1s", plan.rootDecision(1, 10).expandedNode.state.label, "a");
    check("plan 2s", plan.rootDecision(2, 10).expandedNode.state.label, "aa");

    check("exit expand", plan.rootDecision(0, 2).expandedNode.state.label, "aaa");
    check("exit on best child", plan.rootDecision(0, 2).expandedNode.state.label, "aaab");

    const noPlan = createSearch();

    check("no plan root", noPlan.rootDecision(0).expandedNode.state.label, "");
    check("no plan 1s", noPlan.rootDecision(1).expandedNode.state.label, "a");
    check("no plan 2s", noPlan.rootDecision(2).expandedNode.state.label, "aa");
    check("no plan 3s", noPlan.rootDecision(3).expandedNode.state.label, "aaa");
    check("no plan 4s", noPlan.rootDecision(4).expandedNode.state.label, "aaaa");
} finally {
    Math.random = random;
}

if (failures > 0) {
    process.exit(1);
}

console.log("rbfm plan walk ok");
