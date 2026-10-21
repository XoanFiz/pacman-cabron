// ============================================================
// STRATEGY VERSION
// ============================================================
//
// Kept apart from CALIBRATION_VERSION on purpose: this one versions the
// search convention, not the calibration payload. Bump it whenever a
// persisted strategy graph or value table would mean something different
// under the new code:
//
//   - the composition of the state key (buildStateKey);
//   - the decisions and directions the search is allowed to take;
//   - the node structure or the meaning of a stored value.
//
// Records are saved with this version and discarded when it does not
// match, so values computed under another convention are never reused.
// The first persisted convention had no version field at all; any record
// without strategyVersion is treated as too old and discarded.
//
// Loaded by the page (map.js) and by the calibration worker.
const STRATEGY_VERSION = 2;
