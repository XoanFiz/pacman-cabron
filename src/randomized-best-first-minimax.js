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
    getNodeType,
    createSuccessorIterator,
    onNodeVisit = null,
    onWalkLimit = null,
    getDistribution = null,
    maxExtendDepth = 4096
}) {
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

    if (
        onWalkLimit !== null &&
        typeof onWalkLimit !== "function"
    ) {
        throw new TypeError(
            "onWalkLimit must be a function or null."
        );
    }

    if (
        getDistribution !== null &&
        typeof getDistribution !== "function"
    ) {
        throw new TypeError(
            "getDistribution must be a function or null."
        );
    }

    if (!Number.isInteger(maxExtendDepth) || maxExtendDepth <= 0) {
        throw new RangeError(
            "maxExtendDepth must be a positive integer."
        );
    }

    const safeguardCounts = {
        cycle: 0,
        depth: 0
    };

    // Tolerance used to compare game times against the plan end.
    const TIME_EPSILON = 1e-9;

    function chooseRandomChild(node, edges) {
        if (edges.length === 0) {
            return null;
        }

        let bestEdge = null;
        let bestSample = node.type === "max"
            ? -Infinity
            : Infinity;

        for (const edge of edges) {
            const distribution = getDistribution !== null
                ? getDistribution(edge.child)
                : edge.child.distribution;

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

    const search = {
        root: null
    };

    let createdNodeCount = 0;

    // ========================================================
    // NODE CREATION
    // ========================================================
    //
    // Every successor is a new node: there is no transposition table and
    // no state-keyed reuse. A search is a tree and it is discarded when a
    // new root replaces it.

    function createNode(state, initialValue) {
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

        createdNodeCount++;

        return {
            state,
            type,
            value: initialValue,

            arrivalTimes: [],
            successors: [],

            successorIterator: iterator,
            expansionComplete: false,

            searchCount: 0
        };
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

        const child = createNode(
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

    function ensureSuccessorIterator(node) {
        return node.successorIterator;
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

        const iterator = ensureSuccessorIterator(node);

        let addedSuccessors = 0;

        while (true) {
            const result = iterator.next();

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
        const distribution = getDistribution !== null
            ? getDistribution(node)
            : node.distribution;

        return distribution &&
            Number.isFinite(distribution.mean)
            ? distribution.mean
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

    function getRandomChild(node, visited = null) {
        ensureSuccessorOrder(node);

        const edges = visited === null
            ? node.successors
            : node.successors.filter(edge => !visited.has(edge.child));

        if (edges.length === 0) {
            return null;
        }

        const edge = chooseRandomChild(node, edges);

        if (edge === null || !node.successors.includes(edge)) {
            throw new Error(
                "chooseRandomChild must return an edge belonging to the node."
            );
        }

        return edge;
    }


    // ========================================================
    // RBFM EXPLORATION
    // ========================================================

    // Walks down the selected path expanding the first unexpanded node.
    // Iterative on purpose: the recursive version overflowed the stack when
    // the path crossed a long chain or a cycle of already expanded nodes.
    // The walk is bounded and a revisited node stops it, keeping the current
    // static evaluation instead of expanding further.
    // Picks a child not yet on the current path. This is what lets the walk
    // escape a cycle instead of stopping at the first revisit; when every
    // child is visited the node is a dead end and the static value stays.
    function chooseUnvisitedChild(node, mode, visited) {
        ensureSuccessorOrder(node);

        if (node.successors.length === 0) {
            return null;
        }

        if (mode === "improve") {
            for (const edge of node.successors) {
                if (!visited.has(edge.child)) {
                    return edge;
                }
            }

            return null;
        }

        const candidates = node.successors.filter(
            edge => !visited.has(edge.child)
        );

        if (candidates.length === 0) {
            return null;
        }

        return candidates[Math.floor(Math.random() * candidates.length)];
    }

    function extend(node, mode, currentTime, planEndTime = null) {
        if (
            mode !== null &&
            mode !== "improve" &&
            mode !== "worsen"
        ) {
            throw new TypeError(
                'Mode must be null, "improve" or "worsen".'
            );
        }

        if (!Number.isFinite(currentTime)) {
            throw new TypeError(
                "Current time must be a finite number."
            );
        }

        // Inside the plan the walk samples children without alternating:
        // the alternation only starts when the walk leaves the plan.
        const startsInsidePlan = Number.isFinite(planEndTime) &&
            currentTime <= planEndTime + TIME_EPSILON;

        const path = [];
        const visited = new Set();
        let current = node;
        let currentMode = startsInsidePlan ? null : (mode ?? "improve");
        let time = currentTime;
        let expandedNode = node;
        let firstEdge = null;

        while (true) {
            if (!current.expansionComplete) {
                expandNode(current, time);

                if (onNodeVisit !== null) {
                    onNodeVisit(current);
                }

                expandedNode = current;
                break;
            }

            recordSearchVisit(current);

            if (onNodeVisit !== null) {
                onNodeVisit(current);
            }

            if (current.successors.length === 0) {
                expandedNode = current;
                break;
            }

            const edge = currentMode === null
                ? getRandomChild(current, visited)
                : chooseUnvisitedChild(current, currentMode, visited);

            // End of the walkable tree: every child was already visited or
            // the path reached the hard limit. Keep the static evaluation.
            if (edge === null || path.length >= maxExtendDepth) {
                const reason = edge === null ? "cycle" : "depth";

                safeguardCounts[reason]++;

                if (onWalkLimit !== null) {
                    onWalkLimit({
                        reason,
                        pathLength: path.length,
                        maxExtendDepth,
                        nodeCount: createdNodeCount,
                        mode: currentMode,
                        safeguards: { ...safeguardCounts }
                    });
                }

                expandedNode = current;
                break;
            }

            let nextMode;

            if (currentMode === null) {
                // Inside the plan: no alternation yet. The first child that
                // takes the walk past the plan starts the alternation. If it
                // is the best child the walk keeps balancing with "worsen";
                // otherwise it improves from there.
                nextMode = time + edge.duration > planEndTime + TIME_EPSILON
                    ? (edge === getBestChild(current) ? "worsen" : "improve")
                    : null;
            } else {
                const sameType = edge.child.type === current.type;

                nextMode = currentMode === "improve"
                    ? (sameType ? "improve" : "worsen")
                    : (sameType ? "worsen" : "improve");
            }

            if (firstEdge === null) {
                firstEdge = edge;
            }

            visited.add(current);
            path.push({
                node: current,
                edge,
                previousValue: edge.child.value
            });

            current = edge.child;
            currentMode = nextMode;
            time += edge.duration;
        }

        for (let index = path.length - 1; index >= 0; index--) {
            const frame = path[index];

            if (frame.edge.child.value !== frame.previousValue) {
                repositionSuccessor(frame.node, frame.edge);
            }

            updateNodeValue(frame.node);
        }

        return { expandedNode, firstEdge };
    }


    function rootDecision(currentTime, planEndTime = null) {
        if (search.root === null) {
            throw new Error(
                "Cannot run RBFM without a root node."
            );
        }

        const root = search.root;

        if (!root.expansionComplete) {
            return {
                expandedNode: extend(
                    root,
                    "improve",
                    currentTime,
                    planEndTime
                ).expandedNode,
                selectedRootAction: undefined
            };
        }

        if (root.successors.length === 0) {
            return {
                expandedNode: null,
                selectedRootAction: undefined
            };
        }

        // While the root is inside the plan the whole walk stays random
        // until it leaves the plan; then the alternation starts.
        const insidePlan = Number.isFinite(planEndTime) &&
            currentTime <= planEndTime + TIME_EPSILON;

        if (insidePlan) {
            const { expandedNode, firstEdge } = extend(
                root,
                null,
                currentTime,
                planEndTime
            );

            return {
                expandedNode,
                selectedRootAction: firstEdge
                    ? firstEdge.action
                    : undefined
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
            ).expandedNode,
            selectedRootAction: randomEdge.action
        };
    }

    // ========================================================
    // PUBLIC INTERFACE
    // ========================================================

    search.expandNode = expandNode;
    search.updateNodeValue = updateNodeValue;
    search.getBestChild = getBestChild;
    search.rootDecision = rootDecision;

    search.safeguards = safeguardCounts;

    search.setRoot = function (
        state,
        initialValue,
        initialTime = 0
    ) {
        const root = createNode(state, initialValue);

        recordArrival(root, initialTime);

        search.root = root;

        return root;
    };

    return search;
}