// Runs every test under src/tests and prints one summary line.
//
// Every test is a plain node script that throws (or exits non-zero) on
// failure and prints a final "<something> ok" line on success. This
// runner walks the directory, runs each script in its own process and
// reports pass/fail with the duration, so an agent can verify a change
// by reading the last lines instead of the whole suite output.
//
// Usage:
//   node develop/run-tests.js                  every test
//   node develop/run-tests.js --fast           skip the tests that play games
//   node develop/run-tests.js --only strategy  only paths containing "strategy"
//   node develop/run-tests.js --timeout 600    seconds per test (default 300)
//
// Exit code 0 only when every selected test passes.

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const main = path.resolve(__dirname, "..");
const testsRoot = path.join(main, "src", "tests");

// Not a test: the benchmark takes --games/--walks and runs for minutes.
const NOT_TESTS = new Set(["bench.js"]);

// Tests that play real games with the search. They are the slow half of
// the suite, so --fast leaves them out when the change cannot reach the
// strategy.
const SLOW = new Set([
    "behaviour.js",
    "circuit.js",
    "pacman-avoid.js",
    "trap.js"
]);

function parseArguments(argv) {
    const options = { fast: false, only: null, timeout: 300000 };

    for (let index = 0; index < argv.length; index++) {
        const argument = argv[index];

        if (argument === "--fast") {
            options.fast = true;
        } else if (argument === "--only") {
            options.only = argv[++index] || null;
        } else if (argument === "--timeout") {
            options.timeout = Number(argv[++index]) * 1000;
        } else {
            throw new Error("unknown option: " + argument);
        }
    }

    if (!Number.isFinite(options.timeout) || options.timeout <= 0) {
        throw new Error("--timeout needs a positive number of seconds");
    }

    return options;
}

function listTests(directory, found = []) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const fullPath = path.join(directory, entry.name);

        if (entry.isDirectory()) {
            listTests(fullPath, found);
        } else if (entry.name.endsWith(".js") && !NOT_TESTS.has(entry.name)) {
            found.push(fullPath);
        }
    }

    return found.sort();
}

function lastLines(text, count) {
    return text
        .replace(/\s+$/, "")
        .split("\n")
        .slice(-count)
        .join("\n")
        .split("\n")
        .map(line => "  " + line)
        .join("\n");
}

const options = parseArguments(process.argv.slice(2));
const tests = listTests(testsRoot)
    .filter(file => !options.fast || !SLOW.has(path.basename(file)))
    .filter(file => !options.only || file.includes(options.only));

if (tests.length === 0) {
    console.error("no test matched");
    process.exit(1);
}

const startedAt = Date.now();
const failures = [];

for (const file of tests) {
    const name = path.relative(testsRoot, file)
        .replace(/\\/g, "/")
        .replace(/\.js$/, "");
    const testStartedAt = Date.now();
    const result = spawnSync(process.execPath, [file], {
        cwd: main,
        encoding: "utf8",
        timeout: options.timeout
    });
    const seconds = ((Date.now() - testStartedAt) / 1000).toFixed(1);

    if (result.status === 0 && !result.error) {
        console.log("ok   " + name + " (" + seconds + " s)");
        continue;
    }

    failures.push({ name, seconds, result });
    console.log("FAIL " + name + " (" + seconds + " s)");
}

const total = ((Date.now() - startedAt) / 1000).toFixed(1);

for (const failure of failures) {
    console.log("");
    console.log("--- " + failure.name + " (exit " + failure.result.status + ")");

    if (failure.result.error) {
        console.log("  " + failure.result.error.message);
    }

    const output = (failure.result.stdout || "") + (failure.result.stderr || "");

    if (output.replace(/\s+/g, "") !== "") {
        console.log(lastLines(output, 12));
    }
}

console.log("");
console.log(
    (tests.length - failures.length) + "/" + tests.length +
    " passed in " + total + " s" +
    (failures.length === 0
        ? ""
        : " -- failed: " + failures.map(failure => failure.name).join(", "))
);

process.exitCode = failures.length === 0 ? 0 : 1;
