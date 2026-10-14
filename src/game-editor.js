function enterMapEditor() {
    editorDraftMap = cloneMapDefinition(
        maps.find(map => map.id === activeMapId) || maps[0]
    );
    editorMode = true;
    editorGesture = null;
    addingGhost = false;
    window.clearTimeout(editorToastTimer);
    editorToastElement.hidden = true;
    resetGame();
    updateAddGhostButton();
    document.body.classList.add("map-editor-active");
    editorToolbarElement.hidden = false;
    startScreenElement.hidden = true;
    setMapEditorInstructions();
}


function createNewMap() {
    syncEditorDraftMap();
    const sourceMap = editorDraftMap || getCurrentMapDefinition();

    editorDraftMap = cloneMapDefinition(sourceMap);
    editorDraftMap.id = `custom-${nextCustomMapNumber}`;
    editorDraftMap.nameKey = null;
    editorDraftMap.customNumber = nextCustomMapNumber++;
    addingGhost = false;
    resetGame();
    updateAddGhostButton();
    setMapEditorInstructions();
}


function toggleGhostPlacement() {
    addingGhost = !addingGhost;
    updateAddGhostButton();
}


function addGhostAt(position) {
    if (
        !position ||
        map.tiles[position.y][position.x] === "#" ||
        getEditorGhostHouse(position) >= 0 ||
        (player.x === position.x && player.y === position.y) ||
        ghosts.some(ghost => ghost.x === position.x && ghost.y === position.y)
    ) {
        showEditorToast("ghostPlacementError");
        return false;
    }

    const existingColors = ghosts.map((ghost, index) =>
        ghost.color || getGhostColor(index)
    );
    const color = existingColors.length < BASE_GHOST_COLORS.length
        ? BASE_GHOST_COLORS[existingColors.length]
        : getMostDistinctGhostColor(existingColors);
    const newGhost = {
        x: position.x,
        y: position.y,
        px: position.x,
        py: position.y,
        progress: 0,
        frightened: false,
        eaten: false,
        color,
        direction: { ...DIRECTIONS.left },
        nextDirection: { ...DIRECTIONS.left }
    };
    ghosts.push(newGhost);

    const previousTile = map.tiles[position.y][position.x];
    if (map.tiles[position.y][position.x] === "." || map.tiles[position.y][position.x] === "o") {
        map.tiles[position.y][position.x] = " ";
    }

    if (!isEditorMapConnected()) {
        ghosts.pop();
        if (previousTile !== map.tiles[position.y][position.x]) {
            map.tiles[position.y][position.x] = previousTile;
        }
        showEditorToast("mapConnectivityError");
        return false;
    }

    strategicSearch.nodes.clear();
    strategicSearch.frontier = [];
    strategicSearch.root = null;
    syncEditorDraftMap();
    updateAddGhostButton();
    setMapEditorInstructions();

    return true;
}


function syncEditorDraftMap() {
    if (!editorDraftMap) {
        return;
    }

    editorDraftMap.tiles = map.tiles.map(row => row.slice());
    editorDraftMap.edges = Array.from(MAP_EDGES);
    editorDraftMap.playerStart = {
        x: player.x,
        y: player.y,
        direction: { ...player.facingDirection }
    };
    editorDraftMap.ghostStarts = ghosts.map(ghost => ({
        x: ghost.x,
        y: ghost.y,
        color: ghost.color,
        direction: { ...ghost.direction }
    }));
    editorDraftMap.ghostHouses = GHOST_HOUSES.map(cloneMapPosition);
}


function leaveMapEditor(saveChanges) {
    if (saveChanges) {
        syncEditorDraftMap();
        saveEditorMap();
    }

    editorDraftMap = null;
    editorMode = false;
    editorGesture = null;
    addingGhost = false;
    updateCharacterChoices();
    window.clearTimeout(editorToastTimer);
    editorToastElement.hidden = true;
    document.body.classList.remove("map-editor-active");
    editorToolbarElement.hidden = true;
    resetGame();
    updateCharacterChoices();
    startScreenElement.hidden = false;
}


function getEditorPosition(event) {
    const bounds = canvas.getBoundingClientRect();
    const x = Math.floor((event.clientX - bounds.left) * getMapCols(map) / bounds.width);
    const y = Math.floor((event.clientY - bounds.top) * getMapRows(map) / bounds.height);

    if (x < 0 || x >= getMapCols(map) || y < 0 || y >= getMapRows(map)) {
        return null;
    }

    return { x, y };
}


function getEditorBoundary(event) {
    const bounds = canvas.getBoundingClientRect();
    const gridX = (event.clientX - bounds.left) * getMapCols(map) / bounds.width;
    const gridY = (event.clientY - bounds.top) * getMapRows(map) / bounds.height;
    const verticalLine = Math.round(gridX);
    const horizontalLine = Math.round(gridY);
    const verticalDistance = Math.abs(gridX - verticalLine);
    const horizontalDistance = Math.abs(gridY - horizontalLine);
    const edgeTolerance = 0.22;

    if (
        Math.min(verticalDistance, horizontalDistance) > edgeTolerance
    ) {
        return null;
    }

    if (verticalDistance <= horizontalDistance) {
        const y = Math.floor(gridY);
        const x = wrap(verticalLine - 1, getMapCols(map));
        const direction = DIRECTIONS.right;

        return {
            key: getBoundaryKey(x, y, direction),
            x,
            y,
            direction
        };
    }

    const x = Math.floor(gridX);
    const y = wrap(horizontalLine - 1, getMapRows(map));
    const direction = DIRECTIONS.down;

    return {
        key: getBoundaryKey(x, y, direction),
        x,
        y,
        direction
    };
}


function toggleEditorBoundary(boundary) {
    const next = getWrappedPosition(
        boundary.x + boundary.direction.x,
        boundary.y + boundary.direction.y
    );

    if (
        isWall(boundary.x, boundary.y) ||
        isWall(next.x, next.y)
    ) {
        return;
    }

    const wasBlocked = MAP_EDGES.has(boundary.key);

    if (wasBlocked) {
        MAP_EDGES.delete(boundary.key);
    } else {
        MAP_EDGES.add(boundary.key);
    }

    buildGraph();

    if (!isEditorMapConnected()) {
        if (wasBlocked) {
            MAP_EDGES.add(boundary.key);
        } else {
            MAP_EDGES.delete(boundary.key);
        }

        buildGraph();
        showEditorToast("mapConnectivityError");
    }
}


function getEditorEntity(position) {
    if (player.x === position.x && player.y === position.y) {
        return { type: "player", entity: player };
    }

    const ghostIndex = ghosts.findIndex(ghost =>
        ghost.x === position.x && ghost.y === position.y
    );

    return ghostIndex < 0
        ? null
        : { type: "ghost", index: ghostIndex, entity: ghosts[ghostIndex] };
}


function getEditorGhostHouse(position) {
    return GHOST_HOUSES.findIndex(house =>
        house.x === position.x && house.y === position.y
    );
}


function rotateEditorEntity(entity, type) {
    const currentIndex = EDITOR_DIRECTIONS.findIndex(direction =>
        direction.x === entity.direction.x &&
        direction.y === entity.direction.y
    );
    const direction = EDITOR_DIRECTIONS[(currentIndex + 1) % EDITOR_DIRECTIONS.length];

    entity.direction = { ...direction };
    entity.nextDirection = { ...direction };

    if (type === "player") {
        entity.facingDirection = { ...direction };
    }
}


function moveEditorEntity(gesture, position) {
    const { x, y } = position;

    if (
        map.tiles[y][x] === "#" ||
        getEditorGhostHouse(position) >= 0
    ) {
        return false;
    }

    if (
        gesture.type !== "player" &&
        player.x === x && player.y === y
    ) {
        return false;
    }

    if (ghosts.some((ghost, index) =>
        ghost.x === x &&
        ghost.y === y &&
        !(gesture.type === "ghost" && index === gesture.index)
    )) {
        return false;
    }

    const entity = gesture.entity;
    const previousPosition = {
        x: entity.x,
        y: entity.y,
        px: entity.px,
        py: entity.py,
        progress: entity.progress
    };
    entity.x = x;
    entity.y = y;
    entity.px = x;
    entity.py = y;
    entity.progress = 0;

    if (!isEditorMapConnected()) {
        Object.assign(entity, previousPosition);
        showEditorToast("mapConnectivityError");
        return false;
    }

    if (gesture.type === "player") {
        entity.nextDirection = { ...entity.direction };
    } else {
        entity.needsDirection = false;
    }

    return true;
}


function isEditorMapConnected() {
    const targets = [
        { x: player.x, y: player.y },
        ...ghosts.map(ghost => ({ x: ghost.x, y: ghost.y })),
        ...GHOST_HOUSES,
        ...map.tiles.flatMap((row, y) =>
            Array.from(row, (tile, x) =>
                tile === "." || tile === "o"
                    ? { x, y }
                    : null
            ).filter(Boolean)
        )
    ];
    const reached = new Set([`${player.x},${player.y}`]);
    const queue = [{ x: player.x, y: player.y }];

    for (let index = 0; index < queue.length; index++) {
        const current = queue[index];

        for (const next of graph[current.y][current.x]) {
            const key = `${next.x},${next.y}`;

            if (reached.has(key)) {
                continue;
            }

            reached.add(key);
            queue.push({ x: next.x, y: next.y });
        }
    }

    return targets.every(target =>
        reached.has(`${target.x},${target.y}`)
    );
}


function cycleEditorTile(position) {
    const houseIndex = getEditorGhostHouse(position);
    const cycle = [".", "o", " ", "house", "#"];
    const currentTile = houseIndex >= 0
        ? "house"
        : map.tiles[position.y][position.x];
    const currentIndex = cycle.indexOf(currentTile);
    const nextTile = cycle[(currentIndex + 1) % cycle.length];

    if (
        houseIndex >= 0 &&
        nextTile !== "house" &&
        GHOST_HOUSES.length <= 1
    ) {
        showEditorToast("mapHouseRequiredError");
        return;
    }

    const previousRow = map.tiles[position.y];
    const previousEdges = new Set(MAP_EDGES);
    const previousHouses = GHOST_HOUSES.map(cloneMapPosition);

    if (houseIndex >= 0) {
        GHOST_HOUSES.splice(houseIndex, 1);
    }

    if (nextTile === "house") {
        GHOST_HOUSES.push({ x: position.x, y: position.y });
    }

    const tile = nextTile;
    const row = map.tiles[position.y];

    row[position.x] = tile;

    if (nextTile === "#") {
        for (const direction of Object.values(DIRECTIONS)) {
            MAP_EDGES.delete(
                getBoundaryKey(position.x, position.y, direction)
            );
        }
    }


    // pellets = MAP.reduce((total, row) =>
    //     total + Array.from(row).filter(cell => cell === "." || cell === "o").length,
    // 0);
    buildGraph();

    if (!isEditorMapConnected()) {
        map.tiles[position.y] = previousRow;
        MAP_EDGES = previousEdges;
        GHOST_HOUSES = previousHouses;
        // pellets = MAP.reduce((total, row) =>
        //     total + Array.from(row).filter(cell => cell === "." || cell === "o").length,
        // 0);
        buildGraph();
        showEditorToast("mapConnectivityError");
    }
}


canvas.addEventListener("pointerdown", event => {
    if (!editorMode) {
        return;
    }

    const position = getEditorPosition(event);
    if (!position) {
        return;
    }

    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    const boundary = getEditorBoundary(event);
    const selected = getEditorEntity(position);

    editorGesture = addingGhost
        ? { type: "add-ghost", start: position, moved: false }
        : boundary
            ? { type: "boundary", edge: boundary, start: position, moved: false }
            : selected
                ? { ...selected, start: position, moved: false }
                : { type: "tile", start: position, moved: false };
});


canvas.addEventListener("pointermove", event => {
    if (
        !editorMode ||
        !editorGesture ||
        (editorGesture.type !== "player" && editorGesture.type !== "ghost")
    ) {
        return;
    }

    const position = getEditorPosition(event);
    if (!position) {
        return;
    }

    if (position.x !== editorGesture.start.x || position.y !== editorGesture.start.y) {
        editorGesture.moved = moveEditorEntity(editorGesture, position) || editorGesture.moved;
    }
});


canvas.addEventListener("pointerup", event => {
    if (!editorMode || !editorGesture) {
        return;
    }

    const gesture = editorGesture;
    editorGesture = null;

    if (gesture.type === "boundary") {
        const boundary = getEditorBoundary(event);

        if (boundary && boundary.key === gesture.edge.key) {
            toggleEditorBoundary(boundary);
        }
        return;
    }

    const position = getEditorPosition(event);

    if (!position) {
        return;
    }

    if (gesture.type === "add-ghost") {
        if (position.x === gesture.start.x && position.y === gesture.start.y) {
            addGhostAt(position);
        }
        return;
    }

    if (gesture.type === "tile") {
        if (position.x === gesture.start.x && position.y === gesture.start.y) {
            cycleEditorTile(position);
        }
        return;
    }

    if (!gesture.moved && position.x === gesture.start.x && position.y === gesture.start.y) {
        rotateEditorEntity(gesture.entity, gesture.type);
    } else if (!gesture.moved) {
        moveEditorEntity(gesture, position);
    }
});


canvas.addEventListener("pointercancel", () => {
    editorGesture = null;
});


document.getElementById("edit-map").addEventListener("click", enterMapEditor);
newMapButton.addEventListener("click", createNewMap);
addGhostButton.addEventListener("click", toggleGhostPlacement);
editorBackButton.addEventListener("click", () => leaveMapEditor(false));
editorSaveButton.addEventListener("click", () => leaveMapEditor(true));
mapSelectElement.addEventListener("change", () => {
    activeMapId = mapSelectElement.value;
    if (
        selectedCharacter.startsWith("ghost-") &&
        Number(selectedCharacter.slice("ghost-".length)) >=
        getCurrentMapDefinition().ghostStarts.length
    ) {
        selectedCharacter = "pacman";
    }
    resetGame();
    updateCharacterChoices();
});
