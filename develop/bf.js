const MAX = "max";
const MIN = "min";

function hasActiveWindow(node) {
    return node.alfa !== undefined &&
           node.beta !== undefined;
}

function clearActiveWindow(node) {
    delete node.alfa;
    delete node.beta;
}


// Creates the children on first visit.
// expandNode must return canonical graph nodes.
function prepareNode(node, expandNode, evaluate) {

    if (node.children !== null)
        return;

    if (node.terminal) {
        node.children = [];
        node.solved = true;
        node.value = node.staticValue ?? evaluate(node);
        return;
    }

    node.children = expandNode(node);

    if (node.children.length === 0) {
        node.terminal = true;
        node.solved = true;
        node.value = node.staticValue ?? evaluate(node);
        return;
    }

    for (const child of node.children) {
        if (child.value === undefined)
            child.value = child.staticValue ?? evaluate(child);

        if (child.solved === undefined)
            child.solved = false;
    }
}


// Updates the provisional minimax value and child ordering.
function backupNode(node) {

    if (node.children === null)
        return;

    if (node.children.length === 0)
        return;

    node.children.sort((a, b) =>
        node.type === MAX
            ? b.value - a.value
            : a.value - b.value
    );

    node.value = node.children[0].value;

    node.solved = node.children.every(child => child.solved);
}


// Reconstructs the currently active line from the root.
// No explicit call stack or global parent pointer is needed.
function getActiveLine(root) {

    const line = [];
    const seen = new Set();
    let node = root;

    while (node && !seen.has(node)) {
        line.push(node);
        seen.add(node);

        const child = node.activeChild;

        if (!child || !hasActiveWindow(child))
            break;

        node = child;
    }

    return line;
}


function explore(root, expandNode, evaluate, maxSteps = 1000) {

    // The root is always evaluated with a full window.
    root.alfa = -Infinity;
    root.beta = +Infinity;

    for (let step = 0; step < maxSteps; step++) {

        const line = getActiveLine(root);
        const node = line[line.length - 1];
        const ancestors = new Set(line);

        // The previously selected child has returned.
        if (
            node.activeChild &&
            !hasActiveWindow(node.activeChild)
        ) {
            node.activeChild = null;
        }

        // Refresh provisional values from the bottom upwards.
        for (let i = line.length - 1; i >= 0; i--)
            backupNode(line[i]);

        prepareNode(node, expandNode, evaluate);
        backupNode(node);

        // A terminal or completely resolved node returns to its parent.
        if (node.solved) {
            clearActiveWindow(node);

            if (node === root)
                return root.value;

            continue;
        }

        // The current line no longer merits further expansion
        // within the window supplied by its parent.
        if (node.value < node.alfa || node.value > node.beta) {
            clearActiveWindow(node);

            if (node === root)
                return root.value;

            continue;
        }

        // Select the most promising child that still has work.
        const candidate = node.children.find(child =>
            !child.solved && !ancestors.has(child)
        );

        // Every remaining continuation would revisit this line.
        if (!candidate) {
            clearActiveWindow(node);

            if (node === root)
                return root.value;

            continue;
        }

        // The best competing value defines the candidate's window.
        const competitors = node.children.filter(
            child => child !== candidate
        );

        let competitorValue;

        if (competitors.length === 0) {
            competitorValue =
                node.type === MAX ? -Infinity : +Infinity;
        } else if (node.type === MAX) {
            competitorValue = Math.max(
                ...competitors.map(child => child.value)
            );
        } else {
            competitorValue = Math.min(
                ...competitors.map(child => child.value)
            );
        }

        if (node.type === MAX) {
            candidate.alfa = Math.max(
                node.alfa,
                competitorValue
            );
            candidate.beta = node.beta;
        } else {
            candidate.alfa = node.alfa;
            candidate.beta = Math.min(
                node.beta,
                competitorValue
            );
        }

        node.activeChild = candidate;
    }

    return root.value;
}