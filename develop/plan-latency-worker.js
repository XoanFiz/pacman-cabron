// Worker shim for develop/plan-latency.js. It runs the real strategy
// worker (src/strategy/worker.js) inside a node worker_thread with the
// self/importScripts API the browser provides, so the measurement uses the
// real plan producer and its timers.
const { parentPort, workerData } = require("worker_threads");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = workerData.root;
if (workerData.seed) {
    let seed = workerData.seed;
    Math.random = () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed / 4294967296;
    };
}
const ctx = vm.createContext({
    console,
    Math,
    JSON,
    Set,
    Map,
    Date,
    setTimeout,
    clearTimeout,
    structuredClone,
    self: {
        postMessage: message => parentPort.postMessage(message)
    }
});

ctx.importScripts = (...files) => {
    for (const file of files) {
        const resolved = path.resolve(root, "src", "strategy", file);
        vm.runInContext(
            fs.readFileSync(resolved, "utf8").replace(/\r\n/g, "\n"),
            ctx,
            { filename: resolved }
        );
    }
};

const workerSource = fs
    .readFileSync(path.resolve(root, "src", "strategy", "worker.js"), "utf8")
    .replace(/\r\n/g, "\n");

vm.runInContext(workerSource, ctx, { filename: "worker.js" });

parentPort.on("message", message => {
    if (ctx.self.onmessage) {
        ctx.self.onmessage({ data: message });
    }
});
