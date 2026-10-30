const { test, describe, before } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

describe("Part 4: Major Visual Redesign of Camera Page", () => {
    const cameraHtmlPath = path.join(__dirname, "../views/camera.html");
    let cameraHtml = "";

    before(() => {
        cameraHtml = fs.readFileSync(cameraHtmlPath, "utf8");
    });

    test("1. Two-column responsive dashboard grid is implemented", () => {
        // Dashboard grid container
        assert.ok(
            cameraHtml.includes("dashboard-main-grid"),
            "Expected .dashboard-main-grid class for two-column desktop layout"
        );
        assert.ok(
            cameraHtml.includes("dashboard-col-primary"),
            "Expected .dashboard-col-primary column for camera preview stage"
        );
        assert.ok(
            cameraHtml.includes("dashboard-col-sidebar"),
            "Expected .dashboard-col-sidebar column for session and upload controls"
        );
        // Mobile responsive collapse
        assert.ok(
            cameraHtml.includes("@media (max-width: 992px)"),
            "Expected media query collapsing grid to 1 column on mobile/tablet"
        );
    });

    test("2. Compact header contains title, camera badge, and status pill", () => {
        assert.ok(
            cameraHtml.includes("dashboard-header"),
            "Expected .dashboard-header container"
        );
        assert.ok(
            cameraHtml.includes('id="camera-badge"'),
            "Expected camera-badge element in header"
        );
        assert.ok(
            cameraHtml.includes("Device Compatibility") || cameraHtml.includes("Camera Verification") || /device compatib/i.test(cameraHtml),
            "Expected 'Device Compatibility' title"
        );
        assert.ok(
            cameraHtml.includes('id="status-pill"'),
            "Expected unified status-pill in header"
        );
    });

    test("3. Camera preview is large and prominent with controls directly below", () => {
        assert.ok(
            cameraHtml.includes('id="preview-container"'),
            "Expected preview-container element"
        );
        assert.ok(
            cameraHtml.includes('id="camera-preview"'),
            "Expected camera-preview video element"
        );
        assert.ok(
            cameraHtml.includes('id="placeholder-view"'),
            "Expected placeholder-view element"
        );
        // Camera controls placed with Start, Stop, and Capture
        assert.ok(
            cameraHtml.includes('id="btn-start-camera"'),
            "Expected btn-start-camera control"
        );
        assert.ok(
            cameraHtml.includes('id="btn-stop-camera"'),
            "Expected btn-stop-camera control"
        );
        assert.ok(
            cameraHtml.includes('id="btn-capture-photo"'),
            "Expected btn-capture-photo control"
        );
    });

    test("4. Capture Session panel groups interval, status, countdown, and session controls", () => {
        assert.ok(
            cameraHtml.includes('id="auto-capture-panel"'),
            "Expected auto-capture-panel container"
        );
        assert.ok(
            cameraHtml.includes('id="session-badge"'),
            "Expected session-badge element"
        );
        assert.ok(
            cameraHtml.includes('id="auto-status-indicator"'),
            "Expected auto-status-indicator element"
        );
        assert.ok(
            cameraHtml.includes('id="auto-capture-interval"'),
            "Expected auto-capture-interval selector"
        );
        assert.ok(
            cameraHtml.includes('id="btn-start-auto-capture"'),
            "Expected btn-start-auto-capture button"
        );
        assert.ok(
            cameraHtml.includes('id="btn-stop-auto-capture"'),
            "Expected btn-stop-auto-capture button"
        );
        // Opt-in automatic upload card
        assert.ok(
            cameraHtml.includes('id="auto-upload-card"'),
            "Expected auto-upload-card container"
        );
        assert.ok(
            cameraHtml.includes('id="toggle-auto-upload"'),
            "Expected toggle-auto-upload toggle switch"
        );
    });

    test("5. Redundant Upload Status & Transfers card is removed and manual upload integrated into gallery", () => {
        assert.ok(
            !cameraHtml.includes('<span>Upload Status &amp; Transfers</span>'),
            "Expected 'Upload Status & Transfers' card title to be removed"
        );
        assert.ok(
            cameraHtml.includes('id="upload-metrics-grid"'),
            "Expected upload-metrics-grid container"
        );
        assert.ok(
            cameraHtml.includes('id="btn-upload-selected"'),
            "Expected btn-upload-selected manual upload trigger"
        );
        assert.ok(
            cameraHtml.includes('id="upload-status-box"'),
            "Expected upload-status-box feedback container"
        );
    });

    test("6. Distinct full-width Photo Gallery section", () => {
        assert.ok(
            cameraHtml.includes('id="gallery-section"'),
            "Expected gallery-section container"
        );
        assert.ok(
            cameraHtml.includes('id="gallery-count-badge"'),
            "Expected gallery-count-badge element"
        );
        assert.ok(
            cameraHtml.includes('id="gallery-limit-banner"'),
            "Expected gallery-limit-banner warning element"
        );
        assert.ok(
            cameraHtml.includes('id="gallery-grid"'),
            "Expected gallery-grid container"
        );
        assert.ok(
            cameraHtml.includes('id="btn-clear-gallery"'),
            "Expected btn-clear-gallery button"
        );
    });

    test("7. All working modal safeguards are preserved", () => {
        assert.ok(
            cameraHtml.includes('id="session-consent-modal"'),
            "Expected session-consent-modal dialog"
        );
        assert.ok(
            cameraHtml.includes('id="clear-gallery-modal"'),
            "Expected clear-gallery-modal dialog"
        );
        assert.ok(
            cameraHtml.includes('id="upload-modal-overlay"'),
            "Expected upload-modal-overlay dialog"
        );
    });
});
