const { test, describe, before } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

describe("Part 3: Capture Session UX Improvements", () => {
    const cameraHtmlPath = path.join(__dirname, "../views/camera.html");
    let cameraHtml = "";

    before(() => {
        cameraHtml = fs.readFileSync(cameraHtmlPath, "utf8");
    });

    test("1. All 7 session states are handled in setSessionState", () => {
        // Required states: Camera Off, Camera Ready, Awaiting Consent, Capture Session Active, Uploading, Paused, Stopped
        assert.ok(
            cameraHtml.includes('case "CAMERA_OFF":'),
            "Expected CAMERA_OFF state case"
        );
        assert.ok(
            cameraHtml.includes('"Camera Off"'),
            "Expected 'Camera Off' state label"
        );

        assert.ok(
            cameraHtml.includes('case "CAMERA_READY":'),
            "Expected CAMERA_READY state case"
        );
        assert.ok(
            cameraHtml.includes('"Camera Ready"'),
            "Expected 'Camera Ready' state label"
        );

        assert.ok(
            cameraHtml.includes('case "AWAITING_CONSENT":'),
            "Expected AWAITING_CONSENT state case"
        );
        assert.ok(
            cameraHtml.includes('"Awaiting Consent"'),
            "Expected 'Awaiting Consent' state label"
        );

        assert.ok(
            cameraHtml.includes('case "SESSION_ACTIVE":'),
            "Expected SESSION_ACTIVE state case"
        );
        assert.ok(
            cameraHtml.includes('"Capture Session Active"'),
            "Expected 'Capture Session Active' state label"
        );

        assert.ok(
            cameraHtml.includes('case "UPLOADING":'),
            "Expected UPLOADING state case"
        );
        assert.ok(
            cameraHtml.includes('"Uploading"'),
            "Expected 'Uploading' state label"
        );

        assert.ok(
            cameraHtml.includes('case "PAUSED":'),
            "Expected PAUSED state case"
        );
        assert.ok(
            cameraHtml.includes('"Paused"'),
            "Expected 'Paused' state label"
        );

        assert.ok(
            cameraHtml.includes('case "STOPPED":'),
            "Expected STOPPED state case"
        );
        assert.ok(
            cameraHtml.includes('"Stopped"'),
            "Expected 'Stopped' state label"
        );
    });

    test("2. Active session timing, countdown, and upload state distinction", () => {
        // Countdown element
        assert.ok(
            cameraHtml.includes('id="countdown-val"'),
            "Expected countdown-val element"
        );
        assert.ok(
            cameraHtml.includes('id="auto-countdown-text"'),
            "Expected auto-countdown-text element"
        );

        // Upload mode note explicitly distinguished in active session state
        assert.ok(
            cameraHtml.includes('"Uploads Enabled"'),
            "Expected explicit 'Uploads Enabled' label"
        );
        assert.ok(
            cameraHtml.includes('"Uploads Off • Local Only"'),
            "Expected explicit 'Uploads Off • Local Only' label to prevent misleading upload implications"
        );

        // Interval selection values (5s, 10s, 30s)
        assert.ok(
            cameraHtml.includes('value="5000"') &&
            cameraHtml.includes('value="10000"') &&
            cameraHtml.includes('value="30000"'),
            "Expected 5s, 10s, 30s interval options"
        );
    });

    test("3. Stop Session button is prominent, styled, and accessible", () => {
        assert.ok(
            cameraHtml.includes('id="btn-stop-auto-capture"'),
            "Expected btn-stop-auto-capture button"
        );
        assert.ok(
            cameraHtml.includes(".btn-auto-stop"),
            "Expected .btn-auto-stop CSS styling"
        );
        // Prominent danger background
        assert.ok(
            cameraHtml.includes("#da3633") || cameraHtml.includes("var(--danger-color)"),
            "Expected prominent danger color for stop button"
        );
    });

    test("4. Live Upload Metrics Grid displays queued, uploading, uploaded, and awaiting retry counts", () => {
        assert.ok(
            cameraHtml.includes('id="upload-metrics-grid"'),
            "Expected upload-metrics-grid container"
        );
        assert.ok(
            cameraHtml.includes('id="metric-queued-val"'),
            "Expected metric-queued-val element"
        );
        assert.ok(
            cameraHtml.includes('id="metric-uploading-val"'),
            "Expected metric-uploading-val element"
        );
        assert.ok(
            cameraHtml.includes('id="metric-uploaded-val"'),
            "Expected metric-uploaded-val element"
        );
        assert.ok(
            cameraHtml.includes('id="metric-failed-val"'),
            "Expected metric-failed-val element"
        );

        // Statistics calculation in updateUploadMetrics()
        assert.ok(
            cameraHtml.includes("function updateUploadMetrics()"),
            "Expected updateUploadMetrics function in script"
        );
        assert.ok(
            cameraHtml.includes("uploadFailed"),
            "Expected uploadFailed tracking in metrics calculation"
        );
    });

    test("5. Failed photos are kept available for manual retry with in-card retry button", () => {
        // Thumbnail retry button rendering
        assert.ok(
            cameraHtml.includes("gallery-item-retry"),
            "Expected gallery-item-retry button class"
        );
        assert.ok(
            cameraHtml.includes("retryPhotoUpload"),
            "Expected retryPhotoUpload function for individual retry"
        );
        // Manual batch upload confirmation modal is preserved
        assert.ok(
            cameraHtml.includes('id="upload-modal-overlay"'),
            "Expected upload-modal-overlay for manual uploads"
        );
        assert.ok(
            cameraHtml.includes('id="btn-modal-confirm-upload"'),
            "Expected btn-modal-confirm-upload button"
        );
    });

    test("6. Gallery capacity limit warning banner and safe eviction", () => {
        // 10-photo memory limit
        assert.ok(
            cameraHtml.includes("MAX_IN_MEMORY_PHOTOS = 10"),
            "Expected MAX_IN_MEMORY_PHOTOS limit set to 10"
        );

        // Limit banner element
        assert.ok(
            cameraHtml.includes('id="gallery-limit-banner"'),
            "Expected gallery-limit-banner element"
        );
        assert.ok(
            cameraHtml.includes('galleryLimitBanner.style.display'),
            "Expected dynamic toggle of galleryLimitBanner based on memory capacity"
        );

        // Eviction protects user-selected photos
        assert.ok(
            cameraHtml.includes("selectedPhotoIds.has"),
            "Expected eviction algorithm to inspect selectedPhotoIds"
        );
    });

    test("7. Clear All requires confirmation if unsent or selected photos exist", () => {
        assert.ok(
            cameraHtml.includes('id="clear-gallery-modal"'),
            "Expected clear-gallery-modal element"
        );
        assert.ok(
            cameraHtml.includes('id="btn-confirm-clear-gallery"'),
            "Expected btn-confirm-clear-gallery button"
        );
        assert.ok(
            cameraHtml.includes('id="btn-cancel-clear-gallery"'),
            "Expected btn-cancel-clear-gallery button"
        );
        assert.ok(
            cameraHtml.includes("requestClearGallery"),
            "Expected requestClearGallery function guarding against accidental photo discard"
        );
    });

    test("8. Accessibility: Keyboard focus states and Escape key modal dismiss", () => {
        // Visible focus ring
        assert.ok(
            cameraHtml.includes(":focus-visible"),
            "Expected :focus-visible CSS rules for accessible navigation"
        );

        // Escape key dismisses modals
        assert.ok(
            cameraHtml.includes('"Escape"'),
            "Expected Escape key listener in script"
        );

        // Accessible roles and labels
        assert.ok(
            cameraHtml.includes('role="dialog"'),
            "Expected role='dialog' on modal overlays"
        );
        assert.ok(
            cameraHtml.includes('aria-modal="true"'),
            "Expected aria-modal='true' on modal overlays"
        );
    });

    test("9. Disabling automatic upload safely aborts in-flight requests", () => {
        assert.ok(
            cameraHtml.includes("autoUploadAbortController.abort()"),
            "Expected abort controller cancellation on toggle disable"
        );
    });
});
