// RENDER
// ============================================================

function draw() {

    ctx.fillStyle =
        "#090b12";


    ctx.fillRect(
        0,
        0,
        canvas.width,
        canvas.height
    );

    drawVoronoiDomains();


    for (
        let y = 0;
        y < ROWS;
        y++
    ) {

        for (
            let x = 0;
            x < COLS;
            x++
        ) {

            const cell =
                MAP[y][x];


            const px =
                x * CELL;

            const py =
                y * CELL;


            if (cell === "#") {

                ctx.fillStyle =
                    "#3156a3";


                ctx.fillRect(
                    px + 2,
                    py + 2,
                    CELL - 4,
                    CELL - 4
                );
            }


            if (
                cell === "." ||
                cell === "o"
            ) {

                ctx.fillStyle =
                    "#f4e7b5";


                ctx.beginPath();


                ctx.arc(
                    px + CELL / 2,
                    py + CELL / 2,
                    cell === "o"
                        ? 5
                        : 2.5,
                    0,
                    Math.PI * 2
                );


                ctx.fill();
            }
        }
    }

    if (editorMode) {
        drawMapEditorGrid();
    }

    drawBoundaryWalls();
    drawGhostHouses();

    drawPlayer();

    for (
        let i = 0;
        i < ghosts.length;
        i++
    ) {

        drawGhost(
            ghosts[i],
            i
        );
    }
}


function drawBoundaryWalls() {
    ctx.fillStyle = editorMode ? "#9dbdff" : "#3156a3";

    for (const edgeKey of MAP_EDGES) {
        const [orientation, rawX, rawY] = edgeKey.split(":");
        const x = Number(rawX);
        const y = Number(rawY);
        const thickness = editorMode ? 5 : 4;

        if (orientation === "h") {
            const edgeX = (x + 1) * CELL - thickness / 2;
            const edgeY = y * CELL;
            ctx.fillRect(edgeX, edgeY, thickness, CELL);

            if (x === COLS - 1) {
                ctx.fillRect(-thickness / 2, edgeY, thickness, CELL);
            }
        } else {
            const edgeX = x * CELL;
            const edgeY = (y + 1) * CELL - thickness / 2;
            ctx.fillRect(edgeX, edgeY, CELL, thickness);

            if (y === ROWS - 1) {
                ctx.fillRect(edgeX, -thickness / 2, CELL, thickness);
            }
        }
    }
}


function drawGhostHouses() {
    for (const house of GHOST_HOUSES) {
        const centerX = house.x * CELL + CELL / 2;
        const centerY = house.y * CELL + CELL / 2;

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


function drawMapEditorGrid() {
    ctx.strokeStyle = "rgba(255, 255, 255, 0.18)";
    ctx.lineWidth = 1;

    for (let x = 0; x <= COLS; x++) {
        ctx.beginPath();
        ctx.moveTo(x * CELL + 0.5, 0);
        ctx.lineTo(x * CELL + 0.5, ROWS * CELL);
        ctx.stroke();
    }

    for (let y = 0; y <= ROWS; y++) {
        ctx.beginPath();
        ctx.moveTo(0, y * CELL + 0.5);
        ctx.lineTo(COLS * CELL, y * CELL + 0.5);
        ctx.stroke();
    }
}


function drawPlayer() {

    const cx =
        player.px * CELL +
        CELL / 2;


    const cy =
        player.py * CELL +
        CELL / 2;


    const facingDirection = player.facingDirection || player.direction;
    let angle = 0;


    if (
        facingDirection.x === -1
    ) {
        angle = Math.PI;
    }


    if (
        facingDirection.y === -1
    ) {
        angle = -Math.PI / 2;
    }


    if (
        facingDirection.y === 1
    ) {
        angle = Math.PI / 2;
    }


    const mouth =
        0.20 +
        Math.abs(
            Math.sin(
                performance.now() / 90
            )
        ) * 0.20;


    ctx.fillStyle =
        "#ffd43b";


    ctx.beginPath();


    ctx.moveTo(
        cx,
        cy
    );


    ctx.arc(
        cx,
        cy,
        11,
        angle + mouth,
        angle +
        Math.PI * 2 -
        mouth
    );


    ctx.closePath();

    ctx.fill();
}


function drawGhost(
    ghost,
    index
) {

    const cx =
        ghost.px * CELL +
        CELL / 2;


    const cy =
        ghost.py * CELL +
        CELL / 2;


    if (ghost.eaten) {

        drawGhostEyes(
            ghost,
            cx,
            cy
        );

        return;
    }


    if (ghost.frightened) {

        const blinking =
            frightenedTimer <= FRIGHTENED_BLINK_TIME &&
            Math.floor(gameTime * FRIGHTENED_BLINK_FREQUENCY) % 2 === 0;

        ctx.fillStyle = blinking
            ? getGhostColor(index)
            : "#3159d6";

    }

    else {

        ctx.fillStyle = getGhostColor(index);
    }


    ctx.beginPath();


    ctx.arc(
        cx,
        cy - 2,
        10,
        Math.PI,
        0
    );


    ctx.lineTo(
        cx + 10,
        cy + 10
    );


    ctx.lineTo(
        cx + 5,
        cy + 6
    );


    ctx.lineTo(
        cx,
        cy + 10
    );


    ctx.lineTo(
        cx - 5,
        cy + 6
    );


    ctx.lineTo(
        cx - 10,
        cy + 10
    );


    ctx.closePath();

    ctx.fill();


    drawGhostEyes(
        ghost,
        cx,
        cy
    );
}


function drawGhostEyes(
    ghost,
    cx,
    cy
) {

    ctx.fillStyle =
        "white";


    ctx.beginPath();


    ctx.arc(
        cx - 4,
        cy - 3,
        3,
        0,
        Math.PI * 2
    );


    ctx.arc(
        cx + 4,
        cy - 3,
        3,
        0,
        Math.PI * 2
    );


    ctx.fill();


    ctx.fillStyle =
        "#263b78";


    ctx.beginPath();


    ctx.arc(
        cx - 4 +
        ghost.direction.x,
        cy - 3 +
        ghost.direction.y,
        1.5,
        0,
        Math.PI * 2
    );


    ctx.arc(
        cx + 4 +
        ghost.direction.x,
        cy - 3 +
        ghost.direction.y,
        1.5,
        0,
        Math.PI * 2
    );


    ctx.fill();
}


// ============================================================
// CONTROLS
// ============================================================

const EDITOR_DIRECTIONS = [
    DIRECTIONS.right,
    DIRECTIONS.down,
    DIRECTIONS.left,
    DIRECTIONS.up
];


function drawVoronoiDomains() {
    if (!showVoronoi) {
        return;
    }

    const domain = calculateDomain({
        respectCurrentMovement: running
    });

    for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {

            if (MAP[y][x] === "#") {
                continue;
            }

            const owners = domain[y][x].owners;

            if (owners.length === 0) {
                continue;
            }

            // We normalize owners to their actual agents.
            const normalizedOwners = [
                ...new Set(
                    owners.map(owner => {
                        if (
                            owner === "powerPacman" ||
                            owner === "pacman"
                        ) {
                            return "pacman";
                        }

                        if (owner.startsWith("recoveredGhost")) {
                            return owner.replace(
                                "recoveredGhost",
                                "ghost"
                            );
                        }

                        return owner;
                    })
                )
            ];

            const colors = normalizedOwners
                .map(owner => {
                    if (owner === "pacman") {
                        return DOMAIN_COLORS.pacman;
                    }

                    if (owner.startsWith("ghost")) {
                        const index = getGhostIndex(owner);
                        return ghosts[index]?.color
                            ? hexToRgb(ghosts[index].color)
                            : getGhostColorRgb(index);
                    }

                    return null;
                })
                .filter(Boolean);

            if (colors.length === 0) {
                continue;
            }

            // The average of the colors allows identifying ties.
            const r = Math.round(
                colors.reduce((sum, c) => sum + c[0], 0)
                / colors.length
            );

            const g = Math.round(
                colors.reduce((sum, c) => sum + c[1], 0)
                / colors.length
            );

            const b = Math.round(
                colors.reduce((sum, c) => sum + c[2], 0)
                / colors.length
            );

            ctx.fillStyle =
                `rgba(${r}, ${g}, ${b}, ${DOMAIN_ALPHA})`;

            ctx.fillRect(
                x * CELL,
                y * CELL,
                CELL,
                CELL
            );
        }
    }
}


// ============================================================
// DOMAIN OWNERS
// ============================================================
