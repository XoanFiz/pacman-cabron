// ============================================================
// CALIBRATION PROTOCOL
// ============================================================
//
// Threads involved:
//
//   main thread (map.js)  --postMessage-->  worker (calibration/worker.js)
//
// A Worker has its own global scope: the two threads share no memory and
// no globals. The only channel between them is postMessage, and the
// payload is structured-cloned (Sets become Sets, objects become copies).
// This file is the single source of truth for that channel.
//
// Request (main thread -> worker):
//
//   {
//     type: CALIBRATION_MESSAGE.start,
//     map,          // map definition; edges are serialized as an array
//     initialState, // strategy.createCurrentGameSearchState(...) output
//     options,      // see normalizeCalibrationOptions()
//     resume,       // optional partial results, see normalizeCalibrationResume()
// The explored strategy values are not sent: the worker reads the map's
// value table from IndexedDB (strategy-values store) to deepen the reference.
//   }
//
// Responses (worker -> main thread):
//
//   { type: CALIBRATION_MESSAGE.progress, status }        // after every step
//   { type: CALIBRATION_MESSAGE.complete, status }        // once finished
//   { type: CALIBRATION_MESSAGE.result, status, result }  // final payload
//   { type: CALIBRATION_MESSAGE.error, error }            // fatal failure
//
// status (produced by runner.js) is:
//   { steps, pending, completed, targetSamples, finished, finishReason,
//     buckets, samples, elapsedMs, percent, etaMs, drift }
// `drift` is { samples, windowSize, pValue, drifted }: the running
// p-value test of the new samples against the assumed calibration.
// `buckets` is how many calibration buckets have samples, `elapsedMs` is
// the time spent in this run and `percent`/`etaMs` estimate how much is
// left (etaMs is null while there is not enough data).
// `samples` is the serializable calibration state: an object keyed by
// `${searchCount},${childCount}` whose values are the raw error samples.
// It is what `resume` sends back to continue a previous run.
//
// result (produced by runner.getResult()) is:
//   { mapId, sampleCount, targetSamples, parameters, completed,
//     finishReason, f, g, samples }
// where f is the mean estimate error per bucket `${searchCount},${childCount}`
// and g is its variance.

const CALIBRATION_MESSAGE = Object.freeze({
    start: "start",
    progress: "progress",
    complete: "complete",
    result: "result",
    error: "error"
});

const CALIBRATION_FINISH_REASON = Object.freeze({
    targetSamples: "target-samples",
    maxSteps: "max-steps",
    drift: "drift"
});

// Bumped whenever the calibration payload, the evaluated heuristic or the
// search changes; entries from another version are recalibrated
// automatically at startup or map selection.
// Version 5: the exploration tree is kept across decisions and the walk
// stops the random phase on the first non-optimal child.
// Version 6: the strategic value is a weighted sum of normalised terms, so
// its scale changed from ~1e-4 to ~0.3.
// Version 7: every Pac-Man is in the state and decides in its own node, so
// the transitions, the key and the joint heuristic differ.
// Version 8: the death mode is modelled, so a "respawn" map keeps the other
// characters in place and gives the caught one an untouchable window.
const CALIBRATION_VERSION = 8;

// Used by the main thread to build the request and by the worker as the
// fallback when a field is missing.
const CALIBRATION_DEFAULT_OPTIONS = Object.freeze({
    // The drift monitor validates the last 50 samples; the extra samples
    // let the test fire before the run would otherwise end.
    targetSamples: 60,
    maxSteps: 4096,
    maxSamplesPerStep: 1,
    // Two simulated seconds of exact minimax; the explored strategy graph
    // supplies values for the states it already knows and the state budget
    // is the safety net for what it does not.
    referenceHorizonSeconds: 2,
    referenceMaxStates: 200
});

// Validates and completes an options object at the thread boundary, so a
// malformed request fails with a clear message instead of deep inside the
// runner.
function normalizeCalibrationOptions(options = {}) {
    const normalized = {
        targetSamples: options.targetSamples ??
            CALIBRATION_DEFAULT_OPTIONS.targetSamples,
        maxSteps: options.maxSteps ??
            CALIBRATION_DEFAULT_OPTIONS.maxSteps,
        maxSamplesPerStep: options.maxSamplesPerStep ??
            CALIBRATION_DEFAULT_OPTIONS.maxSamplesPerStep,
        referenceHorizonSeconds: options.referenceHorizonSeconds ??
            CALIBRATION_DEFAULT_OPTIONS.referenceHorizonSeconds,
        referenceMaxStates: options.referenceMaxStates ??
            CALIBRATION_DEFAULT_OPTIONS.referenceMaxStates
    };

    for (const key of ["targetSamples", "maxSteps", "maxSamplesPerStep", "referenceMaxStates"]) {
        if (!Number.isInteger(normalized[key]) || normalized[key] <= 0) {
            throw new RangeError(`${key} must be a positive integer.`);
        }
    }

    if (
        !Number.isFinite(normalized.referenceHorizonSeconds) ||
        normalized.referenceHorizonSeconds < 0
    ) {
        throw new RangeError(
            "referenceHorizonSeconds must be a finite non-negative number."
        );
    }

    return normalized;
}

// Sanitises the optional partial calibration sent back to the worker so a
// corrupt or empty payload resumes from zero instead of poisoning the run.
function normalizeCalibrationResume(resume) {
    if (!resume || typeof resume !== "object") {
        return { samples: {} };
    }

    const samples = {};

    for (const [key, errors] of Object.entries(resume.samples || {})) {
        if (!/^\d+,\d+$/.test(key) || !Array.isArray(errors)) {
            continue;
        }

        const clean = errors
            .map(Number)
            .filter(Number.isFinite);

        if (clean.length > 0) {
            samples[key] = clean;
        }
    }

    return { samples };
}

// Estimates how far a run is and how much time is left. A run ends at
// either the sample target or the step budget, so the ETA is the sooner
// of both extrapolations and the percentage follows whichever finish
// line is closer.
function estimateCalibrationProgress({
    completed,
    targetSamples,
    steps,
    maxSteps,
    elapsedMs,
    resumedSamples = 0
}) {
    const elapsedSeconds = elapsedMs > 0 ? elapsedMs / 1000 : 0;
    const samplesFraction = targetSamples > 0
        ? Math.min(1, completed / targetSamples)
        : 0;
    const stepsFraction = maxSteps > 0
        ? Math.min(1, steps / maxSteps)
        : 0;
    const percent = Math.max(samplesFraction, stepsFraction);

    const samplesThisRun = Math.max(0, completed - resumedSamples);
    const sampleRate = elapsedSeconds > 0
        ? samplesThisRun / elapsedSeconds
        : 0;
    const stepRate = elapsedSeconds > 0
        ? steps / elapsedSeconds
        : 0;

    const remainingSamples = Math.max(0, targetSamples - completed);
    const remainingSteps = Math.max(0, maxSteps - steps);

    const sampleEta = sampleRate > 0
        ? (remainingSamples / sampleRate) * 1000
        : Infinity;
    const stepEta = stepRate > 0
        ? (remainingSteps / stepRate) * 1000
        : Infinity;

    const etaMs = Math.min(sampleEta, stepEta);

    return {
        percent,
        etaMs: Number.isFinite(etaMs) ? Math.round(etaMs) : null
    };
}

function formatCalibrationEta(etaMs) {
    if (!Number.isFinite(etaMs)) {
        return "unknown";
    }

    const seconds = Math.max(0, Math.round(etaMs / 1000));

    if (seconds < 60) {
        return seconds + "s";
    }

    return Math.floor(seconds / 60) + "m " + (seconds % 60) + "s";
}
