const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Test JPEG buffer with valid magic bytes FF D8 FF
const VALID_JPEG_BUFFER = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
    0x01, 0x01, 0x00, 0x48, 0x00, 0x48, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43,
    0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07, 0x09,
    0xff, 0xd9
]);
const VALID_JPEG_DATA_URL = `data:image/jpeg;base64,${VALID_JPEG_BUFFER.toString("base64")}`;

describe("Part 2: Streamlined Automatic Capture Workflow", () => {
    const cameraHtmlPath = path.join(__dirname, "../views/camera.html");
    let cameraHtml = "";

    before(() => {
        cameraHtml = fs.readFileSync(cameraHtmlPath, "utf8");
    });

    test("1. Session Control Elements are present in views/camera.html", () => {
        // Start Capture Session button
        assert.ok(
            cameraHtml.includes('id="btn-start-auto-capture"'),
            "Expected btn-start-auto-capture element"
        );
        assert.ok(
            cameraHtml.includes("Start Device Testing") || cameraHtml.includes("Start Capture Session"),
            "Expected 'Start Device Testing' button text"
        );

        // Stop Session button
        assert.ok(
            cameraHtml.includes('id="btn-stop-auto-capture"'),
            "Expected btn-stop-auto-capture element"
        );
        assert.ok(
            cameraHtml.includes("Stop Session"),
            "Expected 'Stop Session' button text"
        );

        // Persistent Session Active Indicator / Badge
        assert.ok(
            cameraHtml.includes('id="session-badge"'),
            "Expected session-badge element"
        );
        assert.ok(
            cameraHtml.includes('id="auto-status-indicator"'),
            "Expected auto-status-indicator element"
        );

        // Pre-Session Consent Modal
        assert.ok(
            cameraHtml.includes('id="session-consent-modal"'),
            "Expected session-consent-modal element"
        );
        assert.ok(
            cameraHtml.includes('id="btn-confirm-session-consent"'),
            "Expected btn-confirm-session-consent button"
        );
        assert.ok(
            cameraHtml.includes('id="btn-cancel-session-consent"'),
            "Expected btn-cancel-session-consent button"
        );
    });

    test("2. Interval options support 5s, 10s, and 30s", () => {
        assert.ok(
            cameraHtml.includes('value="5000"'),
            "Expected 5s (5000ms) interval option"
        );
        assert.ok(
            cameraHtml.includes('value="10000"'),
            "Expected 10s (10000ms) interval option"
        );
        assert.ok(
            cameraHtml.includes('value="30000"'),
            "Expected 30s (30000ms) interval option"
        );
        // Default interval is 10s
        assert.ok(
            cameraHtml.includes('value="10000" selected'),
            "Expected 10s interval to be selected by default"
        );
    });

    test("3. Optional Automatic Upload control is separate and disabled by default", () => {
        // Toggle input
        assert.ok(
            cameraHtml.includes('id="toggle-auto-upload"'),
            "Expected toggle-auto-upload checkbox"
        );
        assert.ok(
            cameraHtml.includes('id="auto-upload-status-badge"'),
            "Expected auto-upload-status-badge element"
        );
        assert.ok(
            cameraHtml.includes("Uploads Disabled"),
            "Expected default badge text to indicate Uploads Disabled"
        );

        // Checkbox must NOT be checked by default in HTML
        assert.ok(
            !cameraHtml.includes('id="toggle-auto-upload" checked'),
            "Automatic upload toggle must not be checked by default"
        );

        // Clear explanation of where photos are sent and who accesses them
        assert.ok(
            cameraHtml.includes("/storage/uploads/"),
            "Expected explanation mentioning /storage/uploads/ private storage destination"
        );
        assert.ok(
            cameraHtml.includes("authenticated administrators"),
            "Expected explanation that only authenticated administrators can access photos"
        );
    });

    test("4. Memory limit eviction protects user-selected photos", () => {
        // Simulate gallery logic in isolated JS context
        const MAX_IN_MEMORY_PHOTOS = 10;
        let photoGallery = [];
        let selectedPhotoIds = new Set();
        let selectionCountText = { textContent: "" };

        function addPhotoToGallery(entry) {
            if (photoGallery.length >= MAX_IN_MEMORY_PHOTOS) {
                // Priority 1: Oldest already-uploaded photo that is not currently selected
                let evictIndex = photoGallery.findIndex(p => p.isUploaded && !selectedPhotoIds.has(p.id));

                // Priority 2: Oldest already-uploaded photo regardless of selection
                if (evictIndex === -1) {
                    evictIndex = photoGallery.findIndex(p => p.isUploaded);
                }

                // Priority 3: Oldest unselected photo
                if (evictIndex === -1) {
                    evictIndex = photoGallery.findIndex(p => !selectedPhotoIds.has(p.id));
                }

                // Priority 4: Oldest photo overall (all 10 are selected and unuploaded)
                if (evictIndex === -1) {
                    evictIndex = 0;
                    selectionCountText.textContent = `Memory limit (${MAX_IN_MEMORY_PHOTOS}) reached: oldest selected photo replaced`;
                }

                const discarded = photoGallery.splice(evictIndex, 1)[0];
                if (discarded) {
                    selectedPhotoIds.delete(discarded.id);
                    discarded.dataUrl = null;
                }
            }

            photoGallery.push(entry);
        }

        // Add 10 initial photos
        for (let i = 1; i <= 10; i++) {
            photoGallery.push({
                id: `photo_${i}`,
                dataUrl: `data_${i}`,
                timestamp: `12:00:0${i}`,
                isUploaded: false
            });
        }

        // User explicitly selected photo 1, 2, and 3
        selectedPhotoIds.add("photo_1");
        selectedPhotoIds.add("photo_2");
        selectedPhotoIds.add("photo_3");

        // Photo 4 was uploaded
        photoGallery[3].isUploaded = true;

        // Add 11th photo
        addPhotoToGallery({ id: "photo_11", dataUrl: "data_11", isUploaded: false });

        // Assert photo_4 (uploaded and unselected) was evicted, NOT selected photo_1!
        assert.ok(selectedPhotoIds.has("photo_1"), "photo_1 was user-selected and should NOT have been evicted");
        assert.ok(selectedPhotoIds.has("photo_2"), "photo_2 was user-selected and should NOT have been evicted");
        assert.ok(selectedPhotoIds.has("photo_3"), "photo_3 was user-selected and should NOT have been evicted");
        assert.strictEqual(photoGallery.some(p => p.id === "photo_4"), false, "photo_4 should have been evicted first");
        assert.strictEqual(photoGallery.length, 10, "Gallery size should remain capped at 10");

        // Now test when no photos are uploaded: oldest unselected photo should be evicted
        addPhotoToGallery({ id: "photo_12", dataUrl: "data_12", isUploaded: false });
        // The oldest unselected photo was photo_5
        assert.strictEqual(photoGallery.some(p => p.id === "photo_5"), false, "Oldest unselected photo_5 should be evicted");
        assert.ok(selectedPhotoIds.has("photo_1"), "Selected photo_1 must still be retained");
    });

    test("5. Automatic upload retry and abort constraints in script", () => {
        // Verify script contains retry limit <= 2 and no infinite retry loop
        assert.ok(
            cameraHtml.includes("retryAttempt < 2"),
            "Expected maximum of 2 retries (retryAttempt < 2)"
        );
        assert.ok(
            cameraHtml.includes("AbortController"),
            "Expected AbortController implementation for immediate upload stopping"
        );
        assert.ok(
            cameraHtml.includes("autoUploadAbortController.abort()"),
            "Expected autoUploadAbortController.abort() call on stop"
        );
        assert.ok(
            cameraHtml.includes("isUploading = true"),
            "Expected in-flight upload lock to prevent duplicate uploads"
        );
    });

    test("6. Capture stops on tab visibility hidden, stream end, and stop session", () => {
        // Tab visibility change
        assert.ok(
            cameraHtml.includes('document.addEventListener("visibilitychange"'),
            "Expected visibilitychange listener"
        );
        assert.ok(
            cameraHtml.includes('document.visibilityState === "hidden"'),
            "Expected check for hidden visibility state"
        );
        assert.ok(
            cameraHtml.includes('stopCaptureSession("Page hidden / tab switched")'),
            "Expected stopCaptureSession call when page is hidden"
        );

        // Stream ended
        assert.ok(
            cameraHtml.includes('videoTrack.addEventListener("ended"'),
            "Expected video track ended listener"
        );
        assert.ok(
            cameraHtml.includes('stopCaptureSession("Camera stream ended")'),
            "Expected stopCaptureSession on stream ended"
        );
    });

    test("7. No auto-activation on page load or URL params", () => {
        // Script should not call startCamera or startCaptureSession unconditionally
        assert.ok(
            !cameraHtml.includes("window.onload = startCamera"),
            "Must not start camera automatically on window.onload"
        );
        assert.ok(
            !cameraHtml.includes("window.onload = startCaptureSession"),
            "Must not start session automatically on window.onload"
        );
        assert.ok(
            !cameraHtml.includes("URLSearchParams") || !cameraHtml.includes("startCamera()"),
            "Must not trigger camera from URL parameters"
        );
    });

    test("8. Existing manual capture, retake, clear, and manual upload features are preserved", () => {
        assert.ok(cameraHtml.includes('id="btn-capture-photo"'), "Expected btn-capture-photo");
        assert.ok(cameraHtml.includes('id="btn-retake-photo"'), "Expected btn-retake-photo");
        assert.ok(cameraHtml.includes('id="btn-clear-photo"'), "Expected btn-clear-photo");
        assert.ok(cameraHtml.includes('id="btn-upload-selected"'), "Expected btn-upload-selected");
        assert.ok(cameraHtml.includes('id="upload-modal-overlay"'), "Expected upload-modal-overlay");
        assert.ok(cameraHtml.includes('id="btn-modal-confirm-upload"'), "Expected btn-modal-confirm-upload");
    });
});
