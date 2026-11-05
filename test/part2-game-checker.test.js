const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const express = require("express");
const tarkine = require("tarkine");
const cookieParser = require("cookie-parser");

const VALID_JPEG_BASE64 = "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";
const VALID_JPEG_DATA_URL = `data:image/jpeg;base64,${VALID_JPEG_BASE64}`;

describe("Part 2 Game & Storage Game Checker Verification", () => {
    const game2HtmlPath = path.join(__dirname, "../views/game2.html");
    const homeHtmlPath = path.join(__dirname, "../views/home.html");
    const cameraHtmlPath = path.join(__dirname, "../views/camera.html");

    let game2Html = "";
    let homeHtml = "";
    let cameraHtml = "";
    let testServer = null;
    let testBaseUrl = "";
    const router = require("../router");

    before(async () => {
        game2Html = fs.readFileSync(game2HtmlPath, "utf8");
        homeHtml = fs.readFileSync(homeHtmlPath, "utf8");
        cameraHtml = fs.readFileSync(cameraHtmlPath, "utf8");

        const app = express();
        app.set("views", path.join(__dirname, "../views"));
        app.set("view engine", "html");
        app.engine("html", tarkine.renderFile);
        app.use(cookieParser());
        app.use(express.json({ limit: "25mb" }));
        app.use("/", router);

        await new Promise((resolve) => {
            testServer = app.listen(0, () => {
                const port = testServer.address().port;
                testBaseUrl = `http://127.0.0.1:${port}`;
                resolve();
            });
        });
    });

    after(async () => {
        if (testServer) {
            await new Promise((resolve) => testServer.close(resolve));
        }
        // Clean any uploaded test photos
        const uploadsDir = path.join(__dirname, "../storage/uploads");
        if (fs.existsSync(uploadsDir)) {
            const files = fs.readdirSync(uploadsDir);
            for (const file of files) {
                if (file.startsWith("secure_photo_")) {
                    try {
                        fs.unlinkSync(path.join(uploadsDir, file));
                    } catch (e) {}
                }
            }
        }
    });

    async function makeRequest(reqPath, options = {}) {
        const url = `${testBaseUrl}${reqPath}`;
        const headers = options.headers || {};
        let body = options.body;

        if (body && typeof body === "object") {
            body = JSON.stringify(body);
            if (!headers["Content-Type"]) {
                headers["Content-Type"] = "application/json";
            }
        }

        const res = await fetch(url, {
            method: options.method || "GET",
            headers,
            body
        });

        const text = await res.text();
        let json = null;
        try {
            json = JSON.parse(text);
        } catch (e) {}

        return { status: res.status, headers: res.headers, text, json };
    }

    test("1. views/game2.html exists and is configured as Part 2 Game", () => {
        assert.ok(fs.existsSync(game2HtmlPath), "views/game2.html file must exist");
        assert.ok(
            game2Html.includes("Part 2 Game"),
            "Expected 'Part 2 Game' in game2.html title or header"
        );
        assert.ok(
            game2Html.includes("RAM &amp; Storage Game Checker") || game2Html.includes("RAM & Storage Game Checker"),
            "Expected 'RAM & Storage Game Checker' title in game2.html"
        );
    });

    test("2. Part 2 Game contains RAM & Storage hardware probes", () => {
        assert.ok(
            game2Html.includes('id="diag-ram-val"'),
            "Expected diag-ram-val element for RAM probing"
        );
        assert.ok(
            game2Html.includes('id="diag-storage-val"'),
            "Expected diag-storage-val element for NVMe storage probing"
        );
        assert.ok(
            game2Html.includes("System RAM &amp; Memory") || game2Html.includes("System RAM & Memory"),
            "Expected System RAM & Memory section"
        );
        assert.ok(
            game2Html.includes("Fast Game Storage"),
            "Expected Fast Game Storage section"
        );
    });

    test("3. Part 2 Game includes 10-second countdown and error state", () => {
        assert.ok(
            game2Html.includes('id="checkup-countdown-val"'),
            "Expected checkup-countdown-val element"
        );
        assert.ok(
            game2Html.includes('id="checkup-underway-status"'),
            "Expected checkup-underway-status banner"
        );
        assert.ok(
            game2Html.includes('id="checkup-error-status"'),
            "Expected checkup-error-status banner"
        );
        assert.ok(
            game2Html.includes("Error occurred: Can't do device check"),
            "Expected 'Error occurred: Can't do device check' error message"
        );
        assert.ok(
            game2Html.includes('id="btn-retry-checkup"'),
            "Expected retry button for device checkup"
        );
    });

    test("4. Stop Session button is removed from visible layout", () => {
        assert.ok(
            game2Html.includes('style="display: none !important;"') || game2Html.includes('display: none;'),
            "Stop session button must remain hidden"
        );
    });

    test("5. views/home.html includes Part 2 Game target card and QR box", () => {
        assert.ok(
            homeHtml.includes("Part 2 Game"),
            "Expected 'Part 2 Game' card title in home.html"
        );
        assert.ok(
            homeHtml.includes('id="copy-game2-btn"'),
            "Expected copy-game2-btn button in home.html"
        );
        assert.ok(
            homeHtml.includes('id="game2-url-text"'),
            "Expected game2-url-text element in home.html"
        );
        assert.ok(
            homeHtml.includes('id="game2-open-link"'),
            "Expected game2-open-link link in home.html"
        );
        assert.ok(
            homeHtml.includes('id="qr-game2-box"'),
            "Expected qr-game2-box QR wrapper in home.html"
        );
        assert.ok(
            homeHtml.includes("/game2"),
            "Expected /game2 route reference in home.html"
        );
    });

    test("6. Route /game2 serves Part 2 Game page with 200 OK", async () => {
        const res = await makeRequest("/game2");
        assert.strictEqual(res.status, 200);
        assert.ok(res.text.includes("Part 2 Game"), "Served page must contain 'Part 2 Game'");
        assert.ok(res.text.includes("RAM &amp; Storage") || res.text.includes("RAM & Storage"), "Served page must contain RAM & Storage");
    });

    test("7. Route /part2-game alias serves Part 2 Game page with 200 OK", async () => {
        const res = await makeRequest("/part2-game");
        assert.strictEqual(res.status, 200);
        assert.ok(res.text.includes("Part 2 Game"), "Served page must contain 'Part 2 Game'");
    });

    test("8. Endpoint /game2/upload accepts photo upload and validates magic bytes", async () => {
        const uploadRes = await makeRequest("/game2/upload", {
            method: "POST",
            body: { photos: [VALID_JPEG_DATA_URL] }
        });
        assert.strictEqual(uploadRes.status, 200);
        assert.strictEqual(uploadRes.json.success, true);
        assert.strictEqual(uploadRes.json.count, 1);
    });
});

