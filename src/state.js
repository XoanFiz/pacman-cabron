function createGameState(parameters = {}) {
    const {
        config
    } = parameters;

    const {
        INITIAL_LIVES
    } = config;

    const canvas = document.getElementById("canvas");
    const ctx = canvas.getContext("2d");

    const scoreElement = document.getElementById("score");
    const livesElement = document.getElementById("lives");
    const pauseButton = document.getElementById("pause");
    const statusElement = document.getElementById("status");
    const editorToastElement = document.getElementById("editor-toast");
    const startScreenElement = document.getElementById("start-screen");
    const editorToolbarElement = document.getElementById("map-editor-toolbar");
    const editorBackButton = document.getElementById("editor-back");
    const editorSaveButton = document.getElementById("editor-save");
    const mapSelectElement = document.getElementById("map-select");
    const newMapButton = document.getElementById("editor-new-map");
    const addGhostButton = document.getElementById("editor-add-ghost");
    const addPacmanButton = document.getElementById("editor-add-pacman");
    const deathModeButton = document.getElementById("editor-death-mode");
    const editorGhostListElement = document.getElementById("editor-ghost-list");
    const editorPacmanListElement = document.getElementById("editor-pacman-list");
    const ghostCharacterChoicesElement = document.getElementById("ghost-character-choices");
    const pressedDirectionKeys = new Set();

    const messages = window.PACMAN_TRANSLATIONS;
    const contentLanguage = window.PACMAN_LOCALE;

    // ============================================================
    // STATE
    // ============================================================

    const currentGameState = {
        score: 0,
        pellets: new Set(),

        // Every Pac-Man on the map. `player` is the one the game shows and
        // the strategy follows: the one the human controls, or the first.
        players: [],
        player: null,
        ghosts: [],

        running: false,
        paused: false,
        gameWon: false,
        deathTimer: 0,
        livesVisibleUntil: 0,
        time: 0
    };

    // The lives everyone reads belong to the Pac-Man the game follows;
    // every Pac-Man keeps its own counter in `players`.
    Object.defineProperty(currentGameState, "lives", {
        get() {
            return currentGameState.player
                ? currentGameState.player.lives
                : INITIAL_LIVES;
        },
        set(value) {
            if (currentGameState.player) {
                currentGameState.player.lives = value;
            }
        }
    });

    // ============================================================
    // DEBUG
    // ============================================================
    const DOMAIN_COLORS = {
        pacman: [255, 212, 59]
    };

    // TODO move this to game-renderer
    const BASE_GHOST_COLORS = ["#e05252", "#e99b35", "#d66ad9"];
    const BASE_PACMAN_COLORS = ["#ffd43b"];
    const ghostColorPalette = BASE_GHOST_COLORS.slice();

    function hexToRgb(hex) {
        return [
            Number.parseInt(hex.slice(1, 3), 16),
            Number.parseInt(hex.slice(3, 5), 16),
            Number.parseInt(hex.slice(5, 7), 16)
        ];
    }

    function hueToRgb(hue) {
        const chroma = 1;
        const h = hue / 60;
        const x = chroma * (1 - Math.abs((h % 2) - 1));
        const segments = [
            [chroma, x, 0],
            [x, chroma, 0],
            [0, chroma, x],
            [0, x, chroma],
            [x, 0, chroma],
            [chroma, 0, x]
        ];
        const [r, g, b] = segments[Math.floor(h) % segments.length];
        const lightnessOffset = 0.18;
        const scale = 0.72;

        return [
            r * scale + lightnessOffset,
            g * scale + lightnessOffset,
            b * scale + lightnessOffset
        ].map(channel => Math.round(channel * 255));
    }

    function rgbToHex([red, green, blue]) {
        return `#${[red, green, blue]
            .map(channel => channel.toString(16).padStart(2, "0"))
            .join("")}`;
    }

    function getMostDistinctGhostColor(existingColors) {
        const existing = existingColors.map(hexToRgb);
        if (existing.length === 0) {
            return BASE_GHOST_COLORS[0];
        }

        let bestColor = null;
        let bestDistance = -Infinity;

        for (let hue = 0; hue < 360; hue += 2) {
            const candidate = hueToRgb(hue);
            const closestDistance = Math.min(
                ...existing.map(color =>
                    Math.sqrt(
                        (candidate[0] - color[0]) ** 2 +
                        (candidate[1] - color[1]) ** 2 +
                        (candidate[2] - color[2]) ** 2
                    )
                )
            );

            if (closestDistance > bestDistance) {
                bestDistance = closestDistance;
                bestColor = candidate;
            }
        }

        return rgbToHex(bestColor);
    }

    function getGhostColor(index) {
        while (ghostColorPalette.length <= index) {
            ghostColorPalette.push(
                getMostDistinctGhostColor(ghostColorPalette)
            );
        }

        return ghostColorPalette[index];
    }

    function getGhostColorRgb(index) {
        return hexToRgb(getGhostColor(index));
    }

    // ============================================================
    // UI HELPERS
    // ============================================================

    function localizeContent() {
        document.documentElement.lang = contentLanguage;
        document.documentElement.dir =
            ["ar", "fa", "he", "ps", "ur"].includes(contentLanguage)
                ? "rtl"
                : "ltr";

        document
            .querySelectorAll("[data-i18n]")
            .forEach(element => {
                element.textContent = messages[element.dataset.i18n];
            });

        document
            .querySelectorAll("[data-i18n-aria-label]")
            .forEach(element => {
                element.setAttribute(
                    "aria-label",
                    messages[element.dataset.i18nAriaLabel]
                );
            });

        document
            .querySelectorAll("[data-dir]")
            .forEach(button => {
                button.setAttribute(
                    "aria-label",
                    messages.directions[button.dataset.dir]
                );
            });
    }

    function setStatus(messageKey) {
        statusElement.textContent = messages[messageKey];
    }

    function showEditorToast(messageKey) {
        editorToastElement.textContent = messages[messageKey];
        editorToastElement.hidden = false;
        window.clearTimeout(state.editorToastTimer);
        state.editorToastTimer = window.setTimeout(() => {
            editorToastElement.hidden = true;
        }, 2600);
    }

    function setMapEditorInstructions() {
        statusElement.textContent =
            `${messages.mapEditorInstructions} ${messages.mapEditorHouseInstructions} ${messages.addGhostInstructions}`;
    }

    localizeContent();

    // Shared mutable state. Everything that other modules read or write
    // lives on this object so the coordinator can wire it by reference.
    const state = {
        // DOM references.
        canvas,
        ctx,
        scoreElement,
        livesElement,
        pauseButton,
        statusElement,
        editorToastElement,
        startScreenElement,
        editorToolbarElement,
        editorBackButton,
        editorSaveButton,
        mapSelectElement,
        newMapButton,
        addGhostButton,
        addPacmanButton,
        deathModeButton,
        editorGhostListElement,
        editorPacmanListElement,
        ghostCharacterChoicesElement,
        pressedDirectionKeys,

        // Localization.
        messages,
        contentLanguage,

        // Game state.
        currentGameState,

        // Direction keys currently held, most recent last. Read only when
        // a character reaches a cell centre; never part of the game state.
        pressedDirections: [],

        // Mutable UI / editor flags.
        selectedCharacter: "pacman",
        editorMode: false,
        editorGesture: null,
        editorToastTimer: 0,
        addingGhost: false,
        addingPacman: false,
        currentTime: 0,
        showVoronoiDomains: false,

        // Debug.
        DOMAIN_COLORS,
        BASE_GHOST_COLORS,
        BASE_PACMAN_COLORS,

        // Helpers.
        localizeContent,
        setStatus,
        showEditorToast,
        setMapEditorInstructions,
        hexToRgb,
        getMostDistinctGhostColor,
        getGhostColor,
        getGhostColorRgb
    };

    return state;
}