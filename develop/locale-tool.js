// Keeps the locale files in the same shape.
//
// Every language is a flat dictionary that shadows the English one: a
// missing key renders as "undefined" in the page, because exactly one
// locale file is loaded. This tool is the only sanctioned way to touch
// them: it adds a key to every language at once and it checks that all
// files expose the same keys as English.
//
// Usage:
//   node develop/locale-tool.js check
//   node develop/locale-tool.js add <key> <english text>
//   node develop/locale-tool.js rename <old key> <new key>
//   node develop/locale-tool.js remove <key>
//
// `add` inserts the English text into every language; translators refine
// it in place, and `check` keeps the structures identical. The tool never
// touches the `directions` block by accident: it compares nested objects
// key by key as well.

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const main = path.resolve(__dirname, "..");
const localesDirectory = path.join(main, "src", "locales");

function localeFiles() {
    return fs.readdirSync(localesDirectory)
        .filter(name => name.endsWith(".js"))
        .sort();
}

function loadLocale(file) {
    const source = fs.readFileSync(path.join(localesDirectory, file), "utf8");
    const context = { window: {} };

    vm.runInNewContext(source, context, { filename: file });

    return context.window.PACMAN_TRANSLATIONS;
}

function keyPaths(dictionary, prefix = "") {
    return Object.entries(dictionary).flatMap(([key, value]) => {
        const current = prefix ? prefix + "." + key : key;

        return value !== null && typeof value === "object"
            ? keyPaths(value, current)
            : [current];
    });
}

function check() {
    const reference = keyPaths(loadLocale("en.js")).sort();
    const problems = [];

    for (const file of localeFiles()) {
        const actual = keyPaths(loadLocale(file)).sort();

        for (const key of reference) {
            if (!actual.includes(key)) {
                problems.push(file + ": missing " + key);
            }
        }

        for (const key of actual) {
            if (!reference.includes(key)) {
                problems.push(file + ": extra " + key);
            }
        }
    }

    if (problems.length > 0) {
        problems.forEach(problem => console.error(problem));
        process.exitCode = 1;
        return;
    }

    console.log(localeFiles().length + " locale files match en.js");
}

// Appends a key before the closing brace, so the dictionaries keep one
// key per line and the nested `directions` block is left untouched.
function insertLine(source, key, value) {
    const closing = source.lastIndexOf("};");

    if (closing < 0) {
        throw new Error("cannot find the end of the dictionary");
    }

    const before = source.slice(0, closing).replace(/\s+$/, "");
    const lastCharacter = before[before.length - 1];
    const separator = lastCharacter === "," || lastCharacter === "{" ? "" : ",";
    const line = "\n    " + JSON.stringify(key) + ": " + JSON.stringify(value) + ",";

    return before + separator + line + "\n" + source.slice(closing);
}

function update(mutate, report) {
    let changed = 0;

    for (const file of localeFiles()) {
        const filePath = path.join(localesDirectory, file);
        const source = fs.readFileSync(filePath, "utf8");
        const next = mutate(source, file);

        if (next !== source) {
            fs.writeFileSync(filePath, next);
            changed++;
        }
    }

    console.log(report(changed));
    check();
}

const [command, first, second] = process.argv.slice(2);

if (command === "check") {
    check();
} else if (command === "add" && first && second !== undefined) {
    update(source => {
        if (source.includes(JSON.stringify(first) + ":")) {
            return source;
        }

        return insertLine(source, first, second);
    }, changed => "key " + first + " added to " + changed + " locale file(s)");
} else if (command === "rename" && first && second) {
    update(source => source.split(JSON.stringify(first) + ":").join(
        JSON.stringify(second) + ":"
    ), changed => "key " + first + " renamed in " + changed + " locale file(s)");
} else if (command === "remove" && first) {
    update(source => source
        .split("\n")
        .filter(line => !line.trimStart().startsWith(JSON.stringify(first) + ":"))
        .join("\n"), changed => "key " + first + " removed from " + changed + " locale file(s)");
} else {
    console.error("usage: check | add <key> <text> | rename <old> <new> | remove <key>");
    process.exitCode = 1;
}
