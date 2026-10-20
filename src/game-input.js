function createGameInput(context) {
    function getControlledGhost() {
        if (!selectedCharacter.startsWith("ghost-")) {
            return null;
        }

        return currentGameState.ghosts[Number(selectedCharacter.slice("ghost-".length))] || null;
    }


    function updatePressedDirectionButtons() {
        const keys = {
            ArrowUp: "up",
            w: "up",
            ArrowDown: "down",
            s: "down",
            ArrowLeft: "left",
            a: "left",
            ArrowRight: "right",
            d: "right"
        };
        const pressedDirections = new Set(
            Array.from(pressedDirectionKeys, key => keys[key])
        );

        document.querySelectorAll("[data-dir]").forEach(button => {
            button.classList.toggle(
                "is-key-pressed",
                pressedDirections.has(button.dataset.dir)
            );
        });
    }


    document
        .querySelector('[data-character="pacman"]')
        .addEventListener("click", event =>
            selectCharacter(event.currentTarget)
        );


    document.addEventListener(
        "keydown",
        event => {
            if (editorMode) {
                if (event.key === "Escape") {
                    leaveMapEditor(false);
                }
                return;
            }

            if (gameWon) {
                return;
            }

            if (event.key.toLowerCase() === "v") {
                showVoronoiDomains = !showVoronoiDomains;
                return;
            }

            if (!startScreenElement.hidden) {
                return;
            }

            const keys = {

                ArrowUp:
                    DIRECTIONS.up,

                w:
                    DIRECTIONS.up,


                ArrowDown:
                    DIRECTIONS.down,

                s:
                    DIRECTIONS.down,


                ArrowLeft:
                    DIRECTIONS.left,

                a:
                    DIRECTIONS.left,


                ArrowRight:
                    DIRECTIONS.right,

                d:
                    DIRECTIONS.right
            };


            const direction =
                keys[event.key] ||
                keys[
                event.key.toLowerCase()
                ];


            if (!direction)
                return;


            event.preventDefault();

            pressedDirectionKeys.add(event.key.length === 1
                ? event.key.toLowerCase()
                : event.key);
            updatePressedDirectionButtons();

            setDirection(
                direction
            );
        }
    );


    document.addEventListener("keyup", event => {
        const key = event.key.length === 1
            ? event.key.toLowerCase()
            : event.key;

        if (pressedDirectionKeys.delete(key)) {
            updatePressedDirectionButtons();
        }
    });


    window.addEventListener("blur", () => {
        pressedDirectionKeys.clear();
        updatePressedDirectionButtons();
    });


    document
        .querySelectorAll(
            "[data-dir]"
        )
        .forEach(button => {

            button.addEventListener("pointerdown", () => {
                button.classList.add("is-pointer-pressed");
            });

            button.addEventListener(
                "click",
                () => {

                    setDirection(
                        DIRECTIONS[
                        button.dataset.dir
                        ]
                    );
                }
            );
        });


    document.addEventListener("pointerup", () => {
        document.querySelectorAll(".is-pointer-pressed").forEach(button => {
            button.classList.remove("is-pointer-pressed");
        });
    });


    document.addEventListener("pointercancel", () => {
        document.querySelectorAll(".is-pointer-pressed").forEach(button => {
            button.classList.remove("is-pointer-pressed");
        });
    });


    document
        .getElementById("restart")
        .addEventListener(
            "click",
            () => {
                if (editorMode) {
                    leaveMapEditor(false);
                } else {
                    resetGame();
                    startScreenElement.hidden = false;
                }
            }
        );

    pauseButton.addEventListener("click", () => {
        if (editorMode || gameWon || currentGameState.lives <= 0 || deathTimer > 0) {
            return;
        }

        if (running) {
            running = false;
            paused = true;
            statusElement.textContent =
                messages.paused || "Paused";
        } else if (paused) {
            paused = false;
            running = true;
            statusElement.textContent = "";
        } else {
            return;
        }

        updatePauseButton();
    });

    return {
        getControlledGhost
    };
}
