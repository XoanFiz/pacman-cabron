/*
 * Randomized Best-First Minimax — generic graph foundation.
 *
 * The caller provides:
 * - state identity;
 * - node type ("min" or "max");
 * - an iterator yielding successor transitions;
 * - randomized child selection based on RBFM node distributions.
 *
 * The algorithm does not evaluate states or generate successors itself.
 */

function createRandomizedBestFirstMinimax({
    getStateKey,
    getNodeType,
    createSuccessorIterator,
    onNodeVisit = null
}) {
    if (typeof getStateKey !== "function") {
        throw new TypeError("getStateKey must be a function.");
    }

    if (typeof getNodeType !== "function") {
        throw new TypeError("getNodeType must be a function.");
    }

    if (typeof createSuccessorIterator !== "function") {
        throw new TypeError(
            "createSuccessorIterator must be a function."
        );
    }
    if (
        onNodeVisit !== null &&
        typeof onNodeVisit !== "function"
    ) {
        throw new TypeError(
            "onNodeVisit must be a function or null."
        );
    }

    function chooseRandomChild(node, edges) {
        if (edges.length === 0) {
            return null;
        }

        let bestEdge = null;
        let bestSample = node.type === "max"
            ? -Infinity
            : Infinity;

        for (const edge of edges) {
            const distribution = edge.child.distribution;

            if (
                !distribution ||
                !Number.isFinite(distribution.mean) ||
                !Number.isFinite(distribution.standardDeviation) ||
                distribution.standardDeviation < 0
            ) {
                throw new Error(
                    "Each child must have a valid score distribution."
                );
            }

            const sample = sampleNormal(
                distribution.mean,
                distribution.standardDeviation
            );

            const isBetter = node.type === "max"
                ? sample > bestSample
                : sample < bestSample;

            if (isBetter) {
                bestSample = sample;
                bestEdge = edge;
            }
        }

        return bestEdge;
    }


    function sampleNormal(mean, standardDeviation) {
        if (standardDeviation === 0) {
            return mean;
        }

        const u1 = 1 - Math.random();
        const u2 = 1 - Math.random();

        const standardNormal =
            Math.sqrt(-2 * Math.log(u1)) *
            Math.cos(2 * Math.PI * u2);

        return mean + standardDeviation * standardNormal;
    }

    const nodes = new Map();

    const search = {
        nodes,
        root: null
    };

    // ========================================================
    // NODE CREATION AND REUSE
    // ========================================================

    function getOrCreateNode(state, initialValue) {
        const key = getStateKey(state);

        if (nodes.has(key)) {
            return nodes.get(key);
        }

        if (!Number.isFinite(initialValue)) {
            throw new TypeError(
                "A new node requires a finite initial value."
            );
        }

        const type = getNodeType(state);

        if (type !== "min" && type !== "max") {
            throw new TypeError(
                'getNodeType must return "min" or "max".'
            );
        }

        const iterator = createSuccessorIterator(state);

        if (
            iterator === null ||
            typeof iterator.next !== "function"
        ) {
            throw new TypeError(
                "createSuccessorIterator must return an iterator."
            );
        }

        const node = {
            key,
            state,
            type,
            value: initialValue,

            arrivalTimes: [],
            successors: [],

            successorIterator: iterator,
            expansionComplete: false,

            searchCount: 0
        };

        nodes.set(key, node);

        return node;
    }

    function recordSearchVisit(node) {
        node.searchCount++;
    }

    // ========================================================
    // MINIMAX VALUE UPDATE
    // ========================================================

    function updateNodeValue(node) {
        ensureSuccessorOrder(node);

        if (node.successors.length === 0) {
            return node.value;
        }

        node.value = node.successors[0].child.value;

        return node.value;
    }

    // ========================================================
    // SUCCESSOR GENERATION
    // ========================================================

    function addSuccessor(node, transition, currentTime) {
        if (
            transition === null ||
            typeof transition !== "object" ||
            !("state" in transition) ||
            !("value" in transition)
        ) {
            throw new TypeError(
                "Each transition must contain state and value fields."
            );
        }

        if (!Number.isFinite(transition.value)) {
            throw new TypeError(
                "Transition value must be a finite number."
            );
        }

        if (
            !Number.isFinite(transition.duration) ||
            transition.duration < 0
        ) {
            throw new TypeError(
                "Transition duration must be a finite non-negative number."
            );
        }

        const child = getOrCreateNode(
            transition.state,
            transition.value
        );

        const edge = {
            parent: node,
            child,
            action: transition.action,
            duration: transition.duration
        };

        insertSuccessor(node, edge);

        recordArrival(
            child,
            currentTime + transition.duration
        );

        return edge;
    }

    function expandNode(node, currentTime) {
        if (node.expansionComplete) {
            return 0;
        }

        if (!Number.isFinite(currentTime)) {
            throw new TypeError(
                "Expansion time must be a finite number."
            );
        }

        ensureSuccessorOrder(node);

        let addedSuccessors = 0;

        while (true) {
            const result = node.successorIterator.next();

            if (result.done) {
                node.expansionComplete = true;
                updateNodeValue(node);

                return addedSuccessors;
            }

            addSuccessor(node, result.value, currentTime);
            addedSuccessors++;
        }
    }

    // ========================================================
    // SUCCESSOR ORDERING
    // ========================================================

    function getComparableValue(node) {
        return node.distribution &&
            Number.isFinite(node.distribution.mean)
            ? node.distribution.mean
            : node.value;
    }

    function comesBefore(node, firstEdge, secondEdge) {
        const firstValue = getComparableValue(firstEdge.child);
        const secondValue = getComparableValue(secondEdge.child);

        return node.type === "max"
            ? firstValue > secondValue
            : firstValue < secondValue;
    }
    function ensureSuccessorOrder(node) {
        const edges = node.successors;

        for (let i = 1; i < edges.length; i++) {
            const edge = edges[i];
            let j = i;

            while (
                j > 0 &&
                comesBefore(node, edge, edges[j - 1])
            ) {
                edges[j] = edges[j - 1];
                j--;
            }

            edges[j] = edge;
        }
    }


    function insertSuccessor(node, edge) {
        let low = 0;
        let high = node.successors.length;

        while (low < high) {
            const middle = Math.floor((low + high) / 2);

            if (comesBefore(node, edge, node.successors[middle])) {
                high = middle;
            } else {
                low = middle + 1;
            }
        }

        node.successors.splice(low, 0, edge);
    }


    function repositionSuccessor(node, edge) {
        const index = node.successors.indexOf(edge);

        if (index === -1) {
            throw new Error(
                "Cannot reposition an edge that does not belong to the node."
            );
        }

        node.successors.splice(index, 1);
        insertSuccessor(node, edge);
    }

    // ========================================================
    // ARRIVAL TIMES
    // ========================================================

    function recordArrival(node, time) {
        if (!Number.isFinite(time)) {
            throw new TypeError(
                "Arrival time must be a finite number."
            );
        }

        node.arrivalTimes.push(time);
    }

    // ========================================================
    // CHILD SELECTION
    // ========================================================

    function getBestChild(node) {
        ensureSuccessorOrder(node);

        return node.successors.length > 0
            ? node.successors[0]
            : null;
    }

    function getRandomChild(node) {
        ensureSuccessorOrder(node)

        if (node.successors.length === 0) {
            return null;
        }

        const edge = chooseRandomChild(
            node,
            node.successors
        );

        if (!node.successors.includes(edge)) {
            throw new Error(
                "chooseRandomChild must return an edge belonging to the node."
            );
        }

        return edge;
    }


    // ========================================================
    // RBFM EXPLORATION
    // ========================================================

    function extend(node, mode, currentTime) {
        if (mode !== "improve" && mode !== "worsen") {
            throw new TypeError(
                'Mode must be "improve" or "worsen".'
            );
        }

        if (!Number.isFinite(currentTime)) {
            throw new TypeError(
                "Current time must be a finite number."
            );
        } 
        
        if (!node.expansionComplete) {
            expandNode(node, currentTime);

            if (onNodeVisit !== null) {
                onNodeVisit(node);
            }

            return node;
        }

        recordSearchVisit(node);

        if (onNodeVisit !== null) {
            onNodeVisit(node);
        }

        if (node.successors.length === 0) {
            return node;
        }

        const edge = mode === "improve"
            ? getBestChild(node)
            : getRandomChild(node);

        if (edge === null) {
            return node;
        }

        const sameType = edge.child.type === node.type;

        const nextMode = mode === "improve"
            ? (sameType ? "improve" : "worsen")
            : (sameType ? "worsen" : "improve");

        const previousValue = edge.child.value;

        const expandedNode = extend(
            edge.child,
            nextMode,
            currentTime + edge.duration
        );

        if (edge.child.value !== previousValue) {
            repositionSuccessor(node, edge);
        }

        updateNodeValue(node);

        return expandedNode;
    }


    function rootDecision(currentTime) {
        if (search.root === null) {
            throw new Error(
                "Cannot run RBFM without a root node."
            );
        }

        const root = search.root;

        if (!root.expansionComplete) {
            return {
                expandedNode: extend(root, "improve", currentTime),
                selectedRootAction: undefined
            };
        }

        if (root.successors.length === 0) {
            return {
                expandedNode: null,
                selectedRootAction: undefined
            };
        }

        const randomEdge = getRandomChild(root);
        const bestEdge = getBestChild(root);

        const mode = randomEdge === bestEdge
            ? "improve"
            : "worsen";

        return {
            expandedNode: extend(
                randomEdge.child,
                mode,
                currentTime + randomEdge.duration
            ),
            selectedRootAction: randomEdge.action
        };
    }

    // ========================================================
    // PUBLIC INTERFACE
    // ========================================================

    search.getOrCreateNode = getOrCreateNode;
    search.expandNode = expandNode;
    search.updateNodeValue = updateNodeValue;
    search.getBestChild = getBestChild;
    search.rootDecision = rootDecision;

    search.setRoot = function (
        state,
        initialValue,
        initialTime = 0
    ) {
        const root = getOrCreateNode(state, initialValue);

        recordArrival(root, initialTime);

        search.root = root;

        return root;
    };

    return search;
}