function createGameInput(parameters = {}) {
    const {
        state,
        map,
        rules,
        ui,
        editor
    } = parameters;

    const DIRECTIONS = map.DIRECTIONS;
    const gameState = () => state.currentGameState;

    function getControlledGhost() {
        if (!state.selectedCharacter.startsWith("ghost-")) {
            return null;
        }

        return gameState().ghosts[
            Number(state.selectedCharacter.slice("ghost-".length))
        ] || null;
    }

    const KEY_NAMES = {
        ArrowUp: "up",
        w: "up",
        ArrowDown: "down",
        s: "down",
        ArrowLeft: "left",
        a: "left",
        ArrowRight: "right",
        d: "right"
    };

    function updatePressedDirectionButtons() {
        const keys = KEY_NAMES;
        const pressedDirections = new Set(
            Array.from(state.pressedDirectionKeys, key => keys[key])
        );

        document.querySelectorAll("[data-dir]").forEach(button => {
            button.classList.toggle(
                "is-key-pressed",
                pressedDirections.has(button.dataset.dir)
            );
        });
    }

    document.addEventListener("keydown", event => {
        const gs = gameState();

        if (state.editorMode) {
            if (event.key === "Escape") {
                editor.leaveMapEditor(false);
            }
            return;
        }

        if (gs.gameWon) {
            return;
        }

        if (event.key.toLowerCase() === "v") {
            state.showVoronoiDomains = !state.showVoronoiDomains;
            return;
        }

        if (!state.startScreenElement.hidden) {
            return;
        }

        const keys = {
            ArrowUp: DIRECTIONS.up,
            w: DIRECTIONS.up,
            ArrowDown: DIRECTIONS.down,
            s: DIRECTIONS.down,
            ArrowLeft: DIRECTIONS.left,
            a: DIRECTIONS.left,
            ArrowRight: DIRECTIONS.right,
            d: DIRECTIONS.right
        };

        const direction =
            keys[event.key] ||
            keys[event.key.toLowerCase()];

        if (!direction)
            return;

        event.preventDefault();

        state.pressedDirectionKeys.add(event.key.length === 1
            ? event.key.toLowerCase()
            : event.key);
        updatePressedDirectionButtons();

        rules.pressDirection(KEY_NAMES[event.key] || KEY_NAMES[event.key.toLowerCase()]);
    });

    document.addEventListener("keyup", event => {
        const key = event.key.length === 1
            ? event.key.toLowerCase()
            : event.key;

        if (state.pressedDirectionKeys.delete(key)) {
            updatePressedDirectionButtons();
        }

        const name = KEY_NAMES[event.key] || KEY_NAMES[event.key.toLowerCase()];

        if (name) {
            rules.releaseDirection(name);
        }
    });

    window.addEventListener("blur", () => {
        state.pressedDirectionKeys.clear();
        updatePressedDirectionButtons();
        rules.releaseAllDirections();
    });

    document
        .querySelectorAll("[data-dir]")
        .forEach(button => {
            button.addEventListener("pointerdown", () => {
                button.classList.add("is-pointer-pressed");
                rules.pressDirection(button.dataset.dir);
            });

            button.addEventListener("pointerup", () => {
                button.classList.remove("is-pointer-pressed");
                rules.releaseDirection(button.dataset.dir);
            });

            button.addEventListener("pointerleave", () => {
                if (button.classList.contains("is-pointer-pressed")) {
                    button.classList.remove("is-pointer-pressed");
                    rules.releaseDirection(button.dataset.dir);
                }
            });

            // Keyboard activation of the button: a short press.
            button.addEventListener("click", event => {
                if (event.detail !== 0) {
                    return;
                }

                rules.pressDirection(button.dataset.dir);
                window.setTimeout(
                    () => rules.releaseDirection(button.dataset.dir),
                    120
                );
            });
        });

    function releasePointerButtons() {
        document.querySelectorAll(".is-pointer-pressed").forEach(button => {
            button.classList.remove("is-pointer-pressed");
            rules.releaseDirection(button.dataset.dir);
        });
    }

    document.addEventListener("pointerup", releasePointerButtons);
    document.addEventListener("pointercancel", releasePointerButtons);

    document
        .getElementById("restart")
        .addEventListener("click", () => {
            if (state.editorMode) {
                editor.leaveMapEditor(false);
            } else {
                rules.resetGame();
                state.startScreenElement.hidden = false;
            }
        });

    state.pauseButton.addEventListener("click", () => {
        const gs = gameState();

        if (state.editorMode || gs.gameWon || gs.lives <= 0 || gs.deathTimer > 0) {
            return;
        }

        if (gs.running) {
            gs.running = false;
            gs.paused = true;
            state.statusElement.textContent = state.messages.paused || "Paused";
        } else if (gs.paused) {
            gs.paused = false;
            gs.running = true;
            state.statusElement.textContent = "";
        } else {
            return;
        }

        ui.updatePauseButton();
    });

    return {
        getControlledGhost
    };
}