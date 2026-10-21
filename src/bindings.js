function createGameBindings(context) {
    function publish(module) {
        Object.assign(context, module);
        Object.assign(globalThis, context);
    }

    return { publish };
}
