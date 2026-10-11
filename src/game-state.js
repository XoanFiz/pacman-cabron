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
const ghostCharacterChoicesElement = document.getElementById("ghost-character-choices");
const pressedDirectionKeys = new Set();

const messages = window.PACMAN_TRANSLATIONS;
const contentLanguage = window.PACMAN_LOCALE;

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
    window.clearTimeout(editorToastTimer);
    editorToastTimer = window.setTimeout(() => {
        editorToastElement.hidden = true;
    }, 2600);
}

function setMapEditorInstructions() {
    statusElement.textContent =
        `${messages.mapEditorInstructions} ${messages.mapEditorHouseInstructions} ${messages.addGhostInstructions}`;
}

localizeContent();

// ============================================================
// DEBUG
// ============================================================
let showVoronoi = false;

const DOMAIN_COLORS = {
    pacman: [255, 212, 59]
};

const BASE_GHOST_COLORS = ["#e05252", "#e99b35", "#d66ad9"];
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

const DOMAIN_ALPHA = 0.35;

// ============================================================
