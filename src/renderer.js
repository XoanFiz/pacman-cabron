function createGameRenderer(parameters = {}) {
    const {
        config,
        state,
        map,
        strategy
    } = parameters;

    const {
        CELL,
        DOMAIN_ALPHA,
        FRIGHTENED_BLINK_TIME,
        FRIGHTENED_BLINK_FREQUENCY
    } = config;

    const gameState = () => state.currentGameState;

    // RENDER
    // ============================================================

    function draw() {
        const gs = gameState();
        const ctx = state.ctx;
        const currentMap = map.currentMap;

        ctx.fillStyle = "#090b12";
        ctx.fillRect(0, 0, state.canvas.width, state.canvas.height);

        drawVoronoiDomains();

        for (let y = 0; y < map.getMapRowCount(currentMap); y++) {
            for (let x = 0; x < currentMap.tiles[y].length; x++) {
                let cell = currentMap.tiles[y][x];

                if (
                    (cell === "." || cell === "o") &&
                    !gs.pellets.has(`${x},${y}`)
                ) {
                    cell = " ";
                }

                const px = x * CELL;
                const py = y * CELL;

                if (cell === "#") {
                    ctx.fillStyle = "#3156a3";
                    ctx.fillRect(px + 2, py + 2, CELL - 4, CELL - 4);
                }

                if (cell === "." || cell === "o") {
                    ctx.fillStyle = "#f4e7b5";
                    ctx.beginPath();
                    ctx.arc(
                        px + CELL / 2,
                        py + CELL / 2,
                        cell === "o" ? 5 : 2.5,
                        0,
                        Math.PI * 2
                    );
                    ctx.fill();
                }
            }
        }

        if (state.editorMode) {
            drawMapEditorGrid();
        }

        drawBoundaryWalls();
        drawGhostHouses();
        drawPlayers();
        drawLivesBadges();

        for (let i = 0; i < gs.ghosts.length; i++) {
            drawGhost(gs.ghosts[i], i);
        }
    }

    function drawBoundaryWalls() {
        const ctx = state.ctx;
        const currentMap = map.currentMap;

        ctx.fillStyle = state.editorMode ? "#9dbdff" : "#3156a3";

        for (const edgeKey of currentMap.edges) {
            const [orientation, rawX, rawY] = edgeKey.split(":");
            const x = Number(rawX);
            const y = Number(rawY);
            const thickness = state.editorMode ? 5 : 4;

            if (orientation === "h") {
                const edgeX = (x + 1) * CELL - thickness / 2;
                const edgeY = y * CELL;
                ctx.fillRect(edgeX, edgeY, thickness, CELL);

                if (x === map.getMapColumnCount(currentMap) - 1) {
                    ctx.fillRect(-thickness / 2, edgeY, thickness, CELL);
                }
            } else {
                const edgeX = x * CELL;
                const edgeY = (y + 1) * CELL - thickness / 2;
                ctx.fillRect(edgeX, edgeY, CELL, thickness);

                if (y === map.getMapRowCount(currentMap) - 1) {
                    ctx.fillRect(edgeX, -thickness / 2, CELL, thickness);
                }
            }
        }
    }

    function drawGhostHouses() {
        const ctx = state.ctx;
        const currentMap = map.currentMap;

        for (let y = 0; y < map.getMapRowCount(currentMap); y++) {
            for (let x = 0; x < map.getMapColumnCount(currentMap); x++) {
                if (currentMap.tiles[y][x] !== "H") {
                    continue;
                }

                const centerX = x * CELL + CELL / 2;
                const centerY = y * CELL + CELL / 2;

                ctx.fillStyle = "#8b5cf6";
                ctx.strokeStyle = "#e9d5ff";
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(centerX - 9, centerY - 1);
                ctx.lineTo(centerX, centerY - 9);
                ctx.lineTo(centerX + 9, centerY - 1);
                ctx.lineTo(centerX + 7, centerY - 1);
                ctx.lineTo(centerX + 7, centerY + 8);
                ctx.lineTo(centerX - 7, centerY + 8);
                ctx.lineTo(centerX - 7, centerY - 1);
                ctx.closePath();
                ctx.fill();
                ctx.stroke();

                ctx.fillStyle = "#090b12";
                ctx.fillRect(centerX - 2, centerY + 2, 4, 6);
            }
        }
    }

    function drawMapEditorGrid() {
        const ctx = state.ctx;
        const currentMap = map.currentMap;

        ctx.strokeStyle = "rgba(255, 255, 255, 0.18)";
        ctx.lineWidth = 1;

        for (let x = 0; x <= map.getMapColumnCount(currentMap); x++) {
            ctx.beginPath();
            ctx.moveTo(x * CELL + 0.5, 0);
            ctx.lineTo(x * CELL + 0.5, map.getMapRowCount(currentMap) * CELL);
            ctx.stroke();
        }

        for (let y = 0; y <= map.getMapRowCount(currentMap); y++) {
            ctx.beginPath();
            ctx.moveTo(0, y * CELL + 0.5);
            ctx.lineTo(map.getMapColumnCount(currentMap) * CELL, y * CELL + 0.5);
            ctx.stroke();
        }
    }

    function drawPlayers() {
        const gs = gameState();

        for (const player of gs.players || [gs.player]) {
            if (player.lives <= 0 || isPlayerBlinking(player)) {
                continue;
            }

            drawPlayer(player);
        }
    }

    // A Pac-Man that just respawned is untouchable for a moment and
    // blinks so the player can tell it is not a normal one yet.
    function isPlayerBlinking(player) {
        if (
            !Number.isFinite(player.invincibleUntil) ||
            player.invincibleUntil <= gameState().time
        ) {
            return false;
        }

        return Math.floor(performance.now() / 120) % 2 === 0;
    }

    function drawPlayer(player) {
        const ctx = state.ctx;

        const cx = player.px * CELL + CELL / 2;
        const cy = player.py * CELL + CELL / 2;

        const facingDirection = player.facingDirection || player.direction;
        let angle = 0;

        if (facingDirection.x === -1) {
            angle = Math.PI;
        }

        if (facingDirection.y === -1) {
            angle = -Math.PI / 2;
        }

        if (facingDirection.y === 1) {
            angle = Math.PI / 2;
        }

        const mouth =
            0.20 +
            Math.abs(
                Math.sin(performance.now() / 90)
            ) * 0.20;

        ctx.fillStyle = player.color || "#ffd43b";
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, 11, angle + mouth, angle + Math.PI * 2 - mouth);
        ctx.closePath();
        ctx.fill();
    }

    // The lives of every Pac-Man are shown over it only when the game
    // starts and after a life is lost, never during normal play.
    function drawLivesBadges() {
        const gs = gameState();

        if (
            state.editorMode ||
            performance.now() >= (gs.livesVisibleUntil || 0)
        ) {
            return;
        }

        const ctx = state.ctx;

        for (const player of gs.players || [gs.player]) {
            if (player.lives <= 0) {
                continue;
            }

            const cx = player.px * CELL + CELL / 2;
            const cy = player.py * CELL + CELL / 2;
            const label = String(player.lives);
            const width = 15 + label.length * 6;

            ctx.fillStyle = "rgba(9, 11, 18, 0.85)";
            ctx.strokeStyle = player.color || "#ffd43b";
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.rect(cx - width / 2, cy - 28, width, 15);
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = "#ffffff";
            ctx.font = "bold 11px system-ui, sans-serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(label, cx, cy - 20);
            ctx.textAlign = "start";
            ctx.textBaseline = "alphabetic";
        }
    }

    function drawGhost(ghost, index) {
        const ctx = state.ctx;

        const cx = ghost.px * CELL + CELL / 2;
        const cy = ghost.py * CELL + CELL / 2;

        if (ghost.eaten) {
            drawGhostEyes(ghost, cx, cy);
            return;
        }

        if (ghost.frightened) {
            const blinking =
                ghost.frightenedTimer <= FRIGHTENED_BLINK_TIME &&
                Math.floor(gameState().time * FRIGHTENED_BLINK_FREQUENCY) % 2 === 0;

            ctx.fillStyle = blinking
                ? state.getGhostColor(index)
                : "#3159d6";
        } else {
            ctx.fillStyle = state.getGhostColor(index);
        }

        ctx.beginPath();
        ctx.arc(cx, cy - 2, 10, Math.PI, 0);
        ctx.lineTo(cx + 10, cy + 10);
        ctx.lineTo(cx + 5, cy + 6);
        ctx.lineTo(cx, cy + 10);
        ctx.lineTo(cx - 5, cy + 6);
        ctx.lineTo(cx - 10, cy + 10);
        ctx.closePath();
        ctx.fill();

        drawGhostEyes(ghost, cx, cy);
    }

    function drawGhostEyes(ghost, cx, cy) {
        const ctx = state.ctx;
        const facing = ghost.facingDirection || ghost.direction;

        ctx.fillStyle = "white";
        ctx.beginPath();
        ctx.arc(cx - 4, cy - 3, 3, 0, Math.PI * 2);
        ctx.arc(cx + 4, cy - 3, 3, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = "#263b78";
        ctx.beginPath();
        ctx.arc(cx - 4 + facing.x, cy - 3 + facing.y, 1.5, 0, Math.PI * 2);
        ctx.arc(cx + 4 + facing.x, cy - 3 + facing.y, 1.5, 0, Math.PI * 2);
        ctx.fill();
    }

    function drawVoronoiDomains() {
        if (!state.showVoronoiDomains) {
            return;
        }

        const ctx = state.ctx;
        const gs = gameState();
        const currentMap = map.currentMap;

        const getGhostIndex = (owner) => owner.replace("ghost", "");

        const domain = strategy.calculateDomain(
            gs.player,
            gs.ghosts,
            map.buildGhostHouses(map.getCurrentMapDefinition()),
            gs.pellets,
            gs.time,
            true
        );

        for (let y = 0; y < map.getMapRowCount(currentMap); y++) {
            for (let x = 0; x < map.getMapColumnCount(currentMap); x++) {
                if (currentMap.tiles[y][x] === "#") {
                    continue;
                }

                const owner = domain[y][x].owner;

                if (!owner || owner === "") {
                    continue;
                }

                let color;

                if (owner === "pacman") {
                    color = state.DOMAIN_COLORS.pacman;
                }

                if (owner.startsWith("ghost")) {
                    const index = getGhostIndex(owner);
                    color = gs.ghosts[index]?.color
                        ? state.hexToRgb(gs.ghosts[index].color)
                        : state.getGhostColorRgb(index);
                }

                if (!color) {
                    continue;
                }

                const [r, g, b] = color;

                ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${DOMAIN_ALPHA})`;
                ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
            }
        }
    }

    return {
        draw
    };
}