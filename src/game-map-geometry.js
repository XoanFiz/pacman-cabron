function createGameMapGeometry() {
    const DIRECTIONS = Object.freeze({
        up: { x: 0, y: -1 },
        down: { x: 0, y: 1 },
        left: { x: -1, y: 0 },
        right: { x: 1, y: 0 }
    });
    function wrap(value, size) {
        return ((value % size) + size) % size;
    }

    function getMapColumnCount(definition) {
        return definition.tiles[0]?.length ?? 0;
    }

    function getMapRowCount(definition) {
        return definition.tiles.length;
    }

    function getBoundaryKey(x, y, direction, definition) {
        const positionX = wrap(x, getMapColumnCount(definition));
        const positionY = wrap(y, getMapRowCount(definition));
        const columnCount = getMapColumnCount(definition);
        const rowCount = getMapRowCount(definition);

        if (direction.x === 1) return `h:${positionX}:${positionY}`;
        if (direction.x === -1) {
            return `h:${wrap(positionX - 1, columnCount)}:${positionY}`;
        }
        if (direction.y === 1) return `v:${positionX}:${positionY}`;
        return `v:${positionX}:${wrap(positionY - 1, rowCount)}`;
    }

    function isWall(x, y, definition) {
        return x < 0 ||
            x >= getMapColumnCount(definition) ||
            y < 0 ||
            y >= getMapRowCount(definition) ||
            definition.tiles[y][x] === "#";
    }

    function isBoundaryBlocked(x, y, direction, definition) {
        return definition.edges.has(
            getBoundaryKey(x, y, direction, definition)
        );
    }

    function canMove(x, y, direction, definition) {
        const nextX = wrap(
            x + direction.x,
            getMapColumnCount(definition)
        );
        const nextY = wrap(
            y + direction.y,
            getMapRowCount(definition)
        );

        return !isWall(nextX, nextY, definition) &&
            !isBoundaryBlocked(x, y, direction, definition);
    }

    function buildGraph(definition, directions = Object.values(DIRECTIONS)) {
        const rowCount = getMapRowCount(definition);
        const columnCount = getMapColumnCount(definition);
        const graph = Array.from(
            { length: rowCount },
            () => Array.from({ length: columnCount }, () => [])
        );

        for (let y = 0; y < rowCount; y++) {
            for (let x = 0; x < columnCount; x++) {
                if (isWall(x, y, definition)) continue;

                for (const direction of directions) {
                    const nextX = wrap(x + direction.x, columnCount);
                    const nextY = wrap(y + direction.y, rowCount);

                    if (canMove(x, y, direction, definition)) {
                        graph[y][x].push({
                            x: nextX,
                            y: nextY,
                            direction
                        });
                    }
                }
            }
        }

        return graph;
    }

    return {
        DIRECTIONS,
        wrap,
        getMapColumnCount,
        getMapRowCount,
        getBoundaryKey,
        isWall,
        isBoundaryBlocked,
        canMove,
        buildGraph
    };
}