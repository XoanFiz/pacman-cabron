function createGameEditor(parameters = {}) {
    const {
        state,
        map,
        rules
    } = parameters;

    const DIRECTIONS = map.DIRECTIONS;
    const EDITOR_DIRECTIONS = [
        DIRECTIONS.up,
        DIRECTIONS.right,
        DIRECTIONS.down,
        DIRECTIONS.left
    ];
    const gameState = () => state.currentGameState;

    function enterMapEditor() {
        map.editorDraftMap = map.cloneMapDefinition(
            map.maps.find(definition => definition.id === map.activeMapId) || map.maps[0]
        );
        state.editorMode = true;
        state.editorGesture = null;
        state.addingGhost = false;
        window.clearTimeout(state.editorToastTimer);
        state.editorToastElement.hidden = true;
        rules.resetGame();
        updateAddGhostButton();
        renderEditorGhostList();
        document.body.classList.add("map-editor-active");
        state.editorToolbarElement.hidden = false;
        state.startScreenElement.hidden = true;
        state.setMapEditorInstructions();
    }

    function createNewMap() {
        syncEditorDraftMap();
        const sourceMap = map.editorDraftMap || map.getCurrentMapDefinition();

        map.editorDraftMap = map.cloneMapDefinition(sourceMap);
        map.editorDraftMap.id = `custom-${map.nextCustomMapNumber}`;
        map.editorDraftMap.nameKey = null;
        map.editorDraftMap.customNumber = map.nextCustomMapNumber++;
        state.addingGhost = false;
        rules.resetGame();
        updateAddGhostButton();
        renderEditorGhostList();
        state.setMapEditorInstructions();
    }

    function toggleGhostPlacement() {
        state.addingGhost = !state.addingGhost;
        updateAddGhostButton();
    }

    function addGhostAt(position) {
        const gs = gameState();
        const currentMap = map.currentMap;

        if (
            !position ||
            currentMap.tiles[position.y][position.x] === "#" ||
            currentMap.tiles[position.y][position.x] === "H" ||
            (gs.player.x === position.x && gs.player.y === position.y) ||
            gs.ghosts.some(ghost => ghost.x === position.x && ghost.y === position.y)
        ) {
            state.showEditorToast("ghostPlacementError");
            return false;
        }

        const color = nextGhostColor(getGhostColors());
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
        gs.ghosts.push(newGhost);

        const previousTile = currentMap.tiles[position.y][position.x];
        if (currentMap.tiles[position.y][position.x] === "." || currentMap.tiles[position.y][position.x] === "o") {
            currentMap.tiles[position.y][position.x] = " ";
        }

        if (!isEditorMapConnected()) {
            gs.ghosts.pop();
            if (previousTile !== currentMap.tiles[position.y][position.x]) {
                currentMap.tiles[position.y][position.x] = previousTile;
            }
            state.showEditorToast("mapConnectivityError");
            return false;
        }

        map.strategicSearch.nodes.clear();
        map.strategicSearch.frontier = [];
        map.strategicSearch.root = null;
        syncEditorDraftMap();
        updateAddGhostButton();
        renderEditorGhostList();
        state.setMapEditorInstructions();

        return true;
    }

    function getGhostColors() {
        return gameState().ghosts.map((ghost, index) =>
            ghost.color || state.getGhostColor(index)
        );
    }

    // Removing a ghost frees its colour so the next added ghost takes it
    // back instead of a new distinct hue.
    function nextGhostColor(existingColors) {
        const used = new Set(
            existingColors.map(color => String(color).toLowerCase())
        );
        const free = state.BASE_GHOST_COLORS.find(
            color => !used.has(color.toLowerCase())
        );

        return free || state.getMostDistinctGhostColor(existingColors);
    }

    function removeGhostAt(index) {
        const gs = gameState();

        if (
            !state.editorMode ||
            !Number.isInteger(index) ||
            index < 0 ||
            index >= gs.ghosts.length
        ) {
            return false;
        }

        gs.ghosts.splice(index, 1);

        if (state.selectedCharacter.startsWith("ghost-")) {
            const selectedIndex = Number(
                state.selectedCharacter.slice("ghost-".length)
            );

            if (selectedIndex === index) {
                state.selectedCharacter = "pacman";
            } else if (selectedIndex > index) {
                state.selectedCharacter = `ghost-${selectedIndex - 1}`;
            }
        }

        map.strategicSearch.nodes.clear();
        map.strategicSearch.frontier = [];
        map.strategicSearch.root = null;
        syncEditorDraftMap();
        updateAddGhostButton();
        renderEditorGhostList();

        return true;
    }

    function renderEditorGhostList() {
        const list = state.editorGhostListElement;
        const gs = gameState();

        if (!list) {
            return;
        }

        const visible = state.editorMode && gs.ghosts.length > 0;

        list.replaceChildren();
        list.hidden = !visible;

        if (!visible) {
            return;
        }

        for (let index = 0; index < gs.ghosts.length; index++) {
            const name = map.getGhostName(index, gs.ghosts);
            const button = document.createElement("button");

            button.type = "button";
            button.className = "editor-ghost-chip";
            button.dataset.ghostIndex = String(index);
            button.title = name;

            const label = document.createElement("span");
            label.textContent = name;

            const remove = document.createElement("span");
            remove.className = "editor-ghost-chip-remove";
            remove.textContent = "\u00d7";

            button.append(
                map.createGhostIcon(
                    gs.ghosts[index].color || state.getGhostColor(index),
                    "character-figure"
                ),
                label,
                remove
            );

            button.addEventListener("click", () => removeGhostAt(index));

            list.append(button);
        }
    }

    function syncEditorDraftMap() {
        const gs = gameState();
        const currentMap = map.currentMap;

        if (!map.editorDraftMap) {
            return;
        }

        map.editorDraftMap.tiles = currentMap.tiles.map(row => row.slice());
        map.editorDraftMap.edges = Array.from(currentMap.edges);
        map.editorDraftMap.playerStarts = (gs.players || [gs.player]).map(
            player => ({
                x: player.x,
                y: player.y,
                direction: { ...player.facingDirection },
                color: player.color
            })
        );
        map.editorDraftMap.ghostStarts = gs.ghosts.map(ghost => ({
            x: ghost.x,
            y: ghost.y,
            color: ghost.color,
            direction: { ...ghost.direction }
        }));
    }

    function leaveMapEditor(saveChanges) {
        if (saveChanges) {
            syncEditorDraftMap();
            map.saveEditorMap();
        }

        map.editorDraftMap = null;
        state.editorMode = false;
        state.editorGesture = null;
        state.addingGhost = false;
        renderEditorGhostList();
        map.updateCharacterChoices();
        window.clearTimeout(state.editorToastTimer);
        state.editorToastElement.hidden = true;
        document.body.classList.remove("map-editor-active");
        state.editorToolbarElement.hidden = true;
        rules.resetGame();
        map.updateCharacterChoices();
        state.startScreenElement.hidden = false;
    }

    function getEditorPosition(event) {
        const currentMap = map.currentMap;
        const bounds = state.canvas.getBoundingClientRect();
        const x = Math.floor((event.clientX - bounds.left) * map.getMapColumnCount(currentMap) / bounds.width);
        const y = Math.floor((event.clientY - bounds.top) * map.getMapRowCount(currentMap) / bounds.height);

        if (x < 0 || x >= map.getMapColumnCount(currentMap) || y < 0 || y >= map.getMapRowCount(currentMap)) {
            return null;
        }

        return { x, y };
    }

    function getEditorBoundary(event) {
        const currentMap = map.currentMap;
        const bounds = state.canvas.getBoundingClientRect();
        const gridX = (event.clientX - bounds.left) * map.getMapColumnCount(currentMap) / bounds.width;
        const gridY = (event.clientY - bounds.top) * map.getMapRowCount(currentMap) / bounds.height;
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
            const x = map.wrap(verticalLine - 1, map.getMapColumnCount(currentMap));
            const direction = DIRECTIONS.right;

            return {
                key: map.getBoundaryKey(x, y, direction),
                x,
                y,
                direction
            };
        }

        const x = Math.floor(gridX);
        const y = map.wrap(horizontalLine - 1, map.getMapRowCount(currentMap));
        const direction = DIRECTIONS.down;

        return {
            key: map.getBoundaryKey(x, y, direction),
            x,
            y,
            direction
        };
    }

    function toggleEditorBoundary(boundary) {
        const currentMap = map.currentMap;
        const next = map.getWrappedPosition(
            boundary.x + boundary.direction.x,
            boundary.y + boundary.direction.y
        );

        if (
            map.isWall(boundary.x, boundary.y) ||
            map.isWall(next.x, next.y)
        ) {
            return;
        }

        const wasBlocked = currentMap.edges.has(boundary.key);

        if (wasBlocked) {
            currentMap.edges.delete(boundary.key);
        } else {
            currentMap.edges.add(boundary.key);
        }

        map.graph = map.buildGraph(currentMap);

        if (!isEditorMapConnected()) {
            if (wasBlocked) {
                currentMap.edges.add(boundary.key);
            } else {
                currentMap.edges.delete(boundary.key);
            }

            map.graph = map.buildGraph(currentMap);
            state.showEditorToast("mapConnectivityError");
        }
    }

    function getEditorEntity(position) {
        const gs = gameState();

        if (gs.player.x === position.x && gs.player.y === position.y) {
            return { type: "player", entity: gs.player };
        }

        const ghostIndex = gs.ghosts.findIndex(ghost =>
            ghost.x === position.x && ghost.y === position.y
        );

        return ghostIndex < 0
            ? null
            : { type: "ghost", index: ghostIndex, entity: gs.ghosts[ghostIndex] };
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
        const gs = gameState();
        const currentMap = map.currentMap;
        const { x, y } = position;

        if (
            currentMap.tiles[y][x] === "#" || currentMap.tiles[y][x] === "H"
        ) {
            return false;
        }

        if (
            gesture.type !== "player" &&
            gs.player.x === x && gs.player.y === y
        ) {
            return false;
        }

        if (gs.ghosts.some((ghost, index) =>
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
            state.showEditorToast("mapConnectivityError");
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
        const gs = gameState();
        const currentMap = map.currentMap;

        const targets = [
            { x: gs.player.x, y: gs.player.y },
            ...gs.ghosts.map(ghost => ({ x: ghost.x, y: ghost.y })),
            ...map.buildGhostHouses(currentMap),
            ...currentMap.tiles.flatMap((row, y) =>
                Array.from(row, (tile, x) =>
                    tile === "." || tile === "o"
                        ? { x, y }
                        : null
                ).filter(Boolean)
            )
        ];
        const reached = new Set([`${gs.player.x},${gs.player.y}`]);
        const queue = [{ x: gs.player.x, y: gs.player.y }];

        for (let index = 0; index < queue.length; index++) {
            const current = queue[index];

            for (const next of map.graph[current.y][current.x]) {
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

    function cycleEditorTile(position, count = 1) {
        const gs = gameState();
        const currentMap = map.currentMap;

        const cycle = [".", "o", " ", "H", "#"];
        const ghostHouses = map.buildGhostHouses(currentMap);
        const currentTile = currentMap.tiles[position.y][position.x];
        const currentIndex = cycle.indexOf(currentTile);
        const oldTile = cycle[currentIndex];
        const nextTile = cycle[(currentIndex + count) % cycle.length];

        if (oldTile == "H" &&
            nextTile !== "H" &&
            ghostHouses.length <= 1
        ) {
            state.showEditorToast("mapHouseRequiredError");
            return;
        }

        const previousRow = currentMap.tiles[position.y].slice();
        const previousEdges = new Set(currentMap.edges);

        const tile = nextTile;
        const row = currentMap.tiles[position.y];

        row[position.x] = tile;

        if (nextTile === "#") {
            for (const direction of Object.values(DIRECTIONS)) {
                currentMap.edges.delete(
                    map.getBoundaryKey(position.x, position.y, direction)
                );
            }
        }

        gs.pellets = map.buildPellets();
        map.graph = map.buildGraph(currentMap);

        if (!isEditorMapConnected()) {
            currentMap.tiles[position.y] = previousRow;
            currentMap.edges = previousEdges;
            gs.pellets = map.buildPellets();
            map.graph = map.buildGraph(currentMap);
            state.showEditorToast("mapConnectivityError");

            cycleEditorTile(position, count + 1);
        }
    }

    function updateAddGhostButton() {
        const color = nextGhostColor(getGhostColors());

        const label = document.createElement("span");
        label.textContent = state.messages.addGhost;

        state.addGhostButton.replaceChildren(
            map.createGhostIcon(color, "ghost-choice-icon"),
            label
        );

        state.addGhostButton.setAttribute(
            "aria-pressed",
            String(state.addingGhost)
        );

        state.addGhostButton.setAttribute(
            "aria-label",
            state.addingGhost
                ? state.messages.cancelAddGhost
                : state.messages.addGhost
        );

        state.addGhostButton.title = state.messages.addGhostInstructions;
    }

    state.canvas.addEventListener("pointerdown", event => {
        if (!state.editorMode) {
            return;
        }

        const position = getEditorPosition(event);
        if (!position) {
            return;
        }

        event.preventDefault();
        state.canvas.setPointerCapture(event.pointerId);
        const boundary = getEditorBoundary(event);
        const selected = getEditorEntity(position);

        state.editorGesture = state.addingGhost
            ? { type: "add-ghost", start: position, moved: false }
            : boundary
                ? { type: "boundary", edge: boundary, start: position, moved: false }
                : selected
                    ? { ...selected, start: position, moved: false }
                    : { type: "tile", start: position, moved: false };
    });

    state.canvas.addEventListener("pointermove", event => {
        if (
            !state.editorMode ||
            !state.editorGesture ||
            (state.editorGesture.type !== "player" && state.editorGesture.type !== "ghost")
        ) {
            return;
        }

        const position = getEditorPosition(event);
        if (!position) {
            return;
        }

        if (position.x !== state.editorGesture.start.x || position.y !== state.editorGesture.start.y) {
            state.editorGesture.moved = moveEditorEntity(state.editorGesture, position) || state.editorGesture.moved;
        }
    });

    state.canvas.addEventListener("pointerup", event => {
        if (!state.editorMode || !state.editorGesture) {
            return;
        }

        const gesture = state.editorGesture;
        state.editorGesture = null;

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

    state.canvas.addEventListener("pointercancel", () => {
        state.editorGesture = null;
    });

    document.getElementById("edit-map").addEventListener("click", enterMapEditor);
    state.newMapButton.addEventListener("click", createNewMap);
    state.addGhostButton.addEventListener("click", toggleGhostPlacement);
    state.editorBackButton.addEventListener("click", () => leaveMapEditor(false));
    state.editorSaveButton.addEventListener("click", () => leaveMapEditor(true));
    state.mapSelectElement.addEventListener("change", () => {
        map.activeMapId = state.mapSelectElement.value;
        if (
            state.selectedCharacter.startsWith("ghost-") &&
            Number(state.selectedCharacter.slice("ghost-".length)) >=
            map.getCurrentMapDefinition().ghostStarts.length
        ) {
            state.selectedCharacter = "pacman";
        }
        rules.resetGame();
        map.updateCharacterChoices();
        void map.ensureMapCalibrated(map.getCurrentMapDefinition());
    });

    return {
        leaveMapEditor
    };
}