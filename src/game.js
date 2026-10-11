(() => {
    const scripts = [
        "game-state.js",
        "game-map.js",
        "game-intelligence.js",
        "game-rules.js",
        "game-renderer.js",
        "game-editor.js",
        "game-runtime.js"
    ];

    const loadScript = index => {
        if (index === scripts.length) {
            return;
        }

        const script = document.createElement("script");
        script.src = `./src/${scripts[index]}`;
        script.onload = () => loadScript(index + 1);
        script.onerror = () => {
            document.getElementById("status").textContent =
                "Unable to load game resources. Please reload the page.";
        };
        document.body.append(script);
    };

    loadScript(0);
})();
