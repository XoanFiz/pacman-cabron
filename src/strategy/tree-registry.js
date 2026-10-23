// ============================================================
// DISTRIBUTED EXPLORATION TREE
// ============================================================
//
// The exploration tree is split between the searchers: every node belongs
// to the searcher that created it and its state stays with it. What is
// shared is the small part of the tree: for every node, its key, owner,
// parent, time, actor, value, revision and its children (key, action and
// value). Every searcher keeps a replica of that list and applies the
// changes the owners broadcast.
//
// Only the owner writes a node: it expands it and it recomputes its value
// from its children. A value change bubbles to the parent, whose owner
// recomputes it and broadcasts it in turn. Nothing else is copied.

const TREE_OPERATION = Object.freeze({
    node: "tree-node",
    expand: "tree-expand",
    value: "tree-value",
    root: "tree-root"
});

function createGameTreeRegistry({
    workerId = 0,
    controlledGhostIndex = -1,
    onBroadcast = null
} = {}) {
    const nodes = new Map();
    let rootKey = null;

    function broadcast(operation) {
        if (typeof onBroadcast === "function") {
            onBroadcast(operation);
        }

        return operation;
    }

    function get(key) {
        return nodes.get(key) || null;
    }

    function has(key) {
        return nodes.has(key);
    }

    function size() {
        return nodes.size;
    }

    function getRootKey() {
        return rootKey;
    }

    function createNode({
        key,
        parent = null,
        time,
        actor,
        playerControlled = false,
        value = 0,
        owner = workerId,
        revision = 0,
        expanded = false,
        children = []
    }) {
        const node = {
            key,
            parent,
            time,
            actor,
            playerControlled,
            value,
            owner,
            revision,
            expanded,
            children
        };

        nodes.set(key, node);

        return node;
    }

    function bestChild(node) {
        if (!node.expanded || node.children.length === 0) {
            return null;
        }

        let best = node.children[0];

        for (const child of node.children) {
            const better = node.actor === "player"
                ? child.value < best.value
                : child.value > best.value;

            if (better) {
                best = child;
            }
        }

        return best;
    }

    function isBestChild(node, key) {
        const best = bestChild(node);

        return best !== null && best.key === key;
    }

    // The owner recomputes a node from its children. Returns the
    // broadcast value operation when the value actually changed.
    function recalculate(key) {
        const node = nodes.get(key);

        if (!node || node.owner !== workerId) {
            return null;
        }

        const best = bestChild(node);

        if (!best || best.value === node.value) {
            return null;
        }

        setValue(key, best.value);

        const operation = broadcast({
            type: TREE_OPERATION.value,
            node: { key, value: node.value, revision: node.revision }
        });

        bubble(node.parent);

        return operation;
    }

    // A child value changed: every ancestor has to be recomputed by its
    // owner. Each owner continues the bubble for the nodes it owns.
    function bubble(key) {
        let current = key;

        while (current !== null) {
            const node = nodes.get(current);

            if (!node || node.owner !== workerId) {
                return;
            }

            const best = bestChild(node);

            if (!best || best.value === node.value) {
                return;
            }

            setValue(current, best.value);
            broadcast({
                type: TREE_OPERATION.value,
                node: {
                    key: current,
                    value: node.value,
                    revision: node.revision
                }
            });
            current = node.parent;
        }
    }

    // The parent keeps the value of each child next to its key, so a value
    // change has to reach both the node and its parent's list.
    function updateParentChildValue(key, value) {
        const node = nodes.get(key);

        if (!node || !node.parent) {
            return;
        }

        const parent = nodes.get(node.parent);

        if (!parent) {
            return;
        }

        const entry = parent.children.find(child => child.key === key);

        if (entry) {
            entry.value = value;
        }
    }

    function setValue(key, value) {
        const node = nodes.get(key);

        if (!node) {
            return null;
        }

        node.value = value;
        node.revision += 1;
        updateParentChildValue(key, value);

        return node;
    }

    // Sets the root the game reached. Only the subtree that hangs from it
    // is kept; the branches that were not taken are dropped.
    function setRoot(key) {
        if (!nodes.has(key)) {
            return false;
        }

        rootKey = key;

        const kept = new Set();
        const stack = [key];

        while (stack.length > 0) {
            const current = stack.pop();

            if (kept.has(current)) {
                continue;
            }

            const node = nodes.get(current);

            if (!node) {
                continue;
            }

            kept.add(current);

            for (const child of node.children) {
                stack.push(child.key);
            }
        }

        for (const nodeKey of [...nodes.keys()]) {
            if (!kept.has(nodeKey)) {
                nodes.delete(nodeKey);
            }
        }

        const root = nodes.get(key);

        if (root) {
            root.parent = null;
        }

        return true;
    }

    // The owner expands a node with the children it generated. The
    // children belong to the expander, which is the one holding their
    // states. Returns false when the replica is out of date.
    function expand(key, children) {
        const node = nodes.get(key);

        if (!node || node.owner !== workerId) {
            return false;
        }

        if (node.expanded) {
            return false;
        }

        node.expanded = true;
        node.revision += 1;
        node.children = children.map(child => ({
            key: child.key,
            action: child.action,
            value: child.value
        }));

        for (const child of children) {
            createNode({
                key: child.key,
                parent: key,
                time: child.time,
                actor: child.actor,
                playerControlled: Boolean(child.playerControlled),
                value: child.value,
                owner: Number.isInteger(child.owner)
                    ? child.owner
                    : workerId
            });
        }

        broadcast({
            type: TREE_OPERATION.expand,
            key,
            revision: node.revision,
            owner: workerId,
            children: node.children.map(child => ({
                ...child,
                time: nodes.get(child.key).time,
                actor: nodes.get(child.key).actor,
                playerControlled: nodes.get(child.key).playerControlled,
                owner: nodes.get(child.key).owner
            }))
        });

        recalculate(key);

        return true;
    }

    // Applies an operation broadcast by another searcher.
    function apply(operation) {
        if (!operation) {
            return false;
        }

        if (operation.type === TREE_OPERATION.node) {
            const node = operation.node;

            if (!nodes.has(node.key)) {
                createNode({ ...node });
            }

            return true;
        }

        if (operation.type === TREE_OPERATION.expand) {
            const node = nodes.get(operation.key);

            if (!node || node.revision >= operation.revision) {
                return false;
            }

            node.expanded = true;
            node.revision = operation.revision;
            node.children = operation.children.map(child => ({
                key: child.key,
                action: child.action,
                value: child.value
            }));

            for (const child of operation.children) {
                if (!nodes.has(child.key)) {
                    createNode({
                        key: child.key,
                        parent: operation.key,
                        time: child.time,
                        actor: child.actor,
                        playerControlled: Boolean(child.playerControlled),
                        value: child.value,
                        owner: Number.isInteger(child.owner)
                            ? child.owner
                            : operation.owner
                    });
                }
            }

            recalculate(node.parent);

            return true;
        }

        if (operation.type === TREE_OPERATION.value) {
            const node = nodes.get(operation.node.key);

            if (!node || node.revision >= operation.node.revision) {
                return false;
            }

            node.value = operation.node.value;
            node.revision = operation.node.revision;
            updateParentChildValue(node.key, node.value);
            recalculate(node.parent);

            return true;
        }

        if (operation.type === TREE_OPERATION.root) {
            return setRoot(operation.key);
        }

        return false;
    }

    // The view that goes to the main thread: the best child for the
    // computer-controlled agents and every direction for the player agent.
    function buildPlan(endTime) {
        if (!rootKey || !nodes.has(rootKey)) {
            return [];
        }

        const plan = [];
        const ids = new Map();
        const pending = [];

        function addNode(key, parent, choice) {
            if (ids.has(key)) {
                return ids.get(key);
            }

            const node = nodes.get(key);

            if (!node || node.time > endTime + 1e-9) {
                return null;
            }

            const id = plan.length;

            ids.set(key, id);
            plan.push({
                id,
                parent,
                choice,
                actor: node.actor,
                action: null,
                choices: null,
                child: null,
                time: node.time,
                key
            });
            pending.push({ id, key });

            return id;
        }

        addNode(rootKey, -1, null);

        while (pending.length > 0) {
            const { id, key } = pending.shift();
            const node = nodes.get(key);
            const planNode = plan[id];

            if (!node.expanded || node.children.length === 0) {
                continue;
            }

            if (node.playerControlled) {
                planNode.choices = [];

                for (const child of node.children) {
                    const direction = node.actor === "player"
                        ? child.action && child.action.playerDirection
                        : controlledGhostIndex >= 0 &&
                            child.action &&
                            (child.action.ghostDirections || []).find(
                                ([index]) =>
                                    index === controlledGhostIndex
                            )?.[1];

                    if (!direction) {
                        continue;
                    }

                    const childId = addNode(child.key, id, {
                        mode: node.actor,
                        index: node.actor === "player"
                            ? -1
                            : controlledGhostIndex,
                        direction: { ...direction }
                    });

                    if (childId !== null) {
                        planNode.choices.push({
                            direction: { ...direction },
                            child: childId
                        });
                    }
                }

                continue;
            }

            const best = bestChild(node);

            if (!best) {
                continue;
            }

            planNode.action = node.actor === "player"
                ? { playerDirection: { ...best.action.playerDirection } }
                : {
                    ghostDirections: (best.action.ghostDirections || []).map(
                        ([index, direction]) => [index, { ...direction }]
                    )
                };
            planNode.child = addNode(best.key, id, null);
        }

        return plan;
    }

    return {
        workerId,
        get,
        has,
        size,
        getRootKey,
        createNode,
        setRoot,
        expand,
        apply,
        setValue,
        recalculate,
        bubble,
        bestChild,
        isBestChild,
        buildPlan,
        nodes
    };
}
