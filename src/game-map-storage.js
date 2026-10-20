function createGameMapStorage({
    databaseName = "pacman-cabron",
    databaseVersion = 1
} = {}) {
    const MAP_STORE = "maps";
    const METADATA_STORE = "metadata";

    function isAvailable() {
        return typeof window !== "undefined" && "indexedDB" in window;
    }

    function requestAsPromise(request) {
        return new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error || new Error("IndexedDB request failed."));
        });
    }

    function openDatabase() {
        if (!isAvailable()) {
            return Promise.resolve(null);
        }

        return new Promise((resolve, reject) => {
            const request = window.indexedDB.open(databaseName, databaseVersion);

            request.onupgradeneeded = () => {
                const database = request.result;

                if (!database.objectStoreNames.contains(MAP_STORE)) {
                    database.createObjectStore(MAP_STORE, { keyPath: "id" });
                }

                if (!database.objectStoreNames.contains(METADATA_STORE)) {
                    database.createObjectStore(METADATA_STORE, { keyPath: "key" });
                }
            };

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error || new Error("Unable to open IndexedDB."));
            request.onblocked = () => reject(new Error("IndexedDB upgrade was blocked."));
        });
    }

    async function load() {
        const database = await openDatabase();

        if (!database) {
            return null;
        }

        try {
            const transaction = database.transaction(
                [MAP_STORE, METADATA_STORE],
                "readonly"
            );
            const mapsRequest = transaction.objectStore(MAP_STORE).getAll();
            const metadataRequest = transaction.objectStore(METADATA_STORE).get("map-state");
            const [maps, metadata] = await Promise.all([
                requestAsPromise(mapsRequest),
                requestAsPromise(metadataRequest)
            ]);

            return {
                maps,
                activeMapId: metadata?.activeMapId,
                nextCustomMapNumber: metadata?.nextCustomMapNumber
            };
        } finally {
            database.close();
        }
    }

    async function save(maps, { activeMapId, nextCustomMapNumber } = {}) {
        const database = await openDatabase();

        if (!database) {
            return false;
        }

        try {
            await new Promise((resolve, reject) => {
                const transaction = database.transaction(
                    [MAP_STORE, METADATA_STORE],
                    "readwrite"
                );
                const mapStore = transaction.objectStore(MAP_STORE);
                const metadataStore = transaction.objectStore(METADATA_STORE);

                mapStore.clear();
                for (const map of maps) {
                    mapStore.put(map);
                }

                metadataStore.put({
                    key: "map-state",
                    activeMapId,
                    nextCustomMapNumber
                });

                transaction.oncomplete = resolve;
                transaction.onerror = () => reject(
                    transaction.error || new Error("Unable to save maps in IndexedDB.")
                );
                transaction.onabort = () => reject(
                    transaction.error || new Error("IndexedDB map transaction aborted.")
                );
            });

            return true;
        } finally {
            database.close();
        }
    }

    return {
        isAvailable,
        load,
        save
    };
}
