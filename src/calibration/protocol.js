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
//     options       // see normalizeCalibrationOptions()
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
//   { steps, pending, completed, targetSamples, finished, finishReason }
//
// result (produced by runner.getResult()) is:
//   { mapId, sampleCount, targetSamples, parameters, completed,
//     finishReason, f, g }
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
    maxSteps: "max-steps"
});

// Used by the main thread to build the request and by the worker as the
// fallback when a field is missing.
const CALIBRATION_DEFAULT_OPTIONS = Object.freeze({
    targetSamples: 8,
    maxSteps: 2048,
    maxSamplesPerStep: 1,
    referenceHorizonSeconds: 2
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
            CALIBRATION_DEFAULT_OPTIONS.referenceHorizonSeconds
    };

    for (const key of ["targetSamples", "maxSteps", "maxSamplesPerStep"]) {
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
