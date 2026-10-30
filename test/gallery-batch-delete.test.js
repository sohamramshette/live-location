const test = require("node:test")
const assert = require("node:assert")
const fs = require("node:fs")
const path = require("node:path")

const config = require("../config")
const router = require("../router")
const { app } = require("../server")

let testServer
let testBaseUrl

// Small sample valid JPEG image (1x1 pixel)
const VALID_JPEG_BASE64 = "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA="
const VALID_JPEG_DATA_URL = `data:image/jpeg;base64,${VALID_JPEG_BASE64}`

test.before(async () => {
    await new Promise((resolve) => {
        testServer = app.listen(0, () => {
            const port = testServer.address().port
            testBaseUrl = `http://127.0.0.1:${port}`
            resolve()
        })
    })
})

test.after(async () => {
    if (testServer) {
        await new Promise((resolve) => testServer.close(resolve))
    }
})

async function makeRequest(urlPath, options = {}) {
    const url = `${testBaseUrl}${urlPath}`
    const headers = options.headers || {}
    let body = options.body

    if (body && typeof body === "object" && !(body instanceof Buffer)) {
        body = JSON.stringify(body)
        if (!headers["Content-Type"]) {
            headers["Content-Type"] = "application/json"
        }
    }

    const res = await fetch(url, {
        method: options.method || "GET",
        headers,
        body: body || undefined,
        redirect: options.redirect || "manual"
    })

    const text = await res.text()
    let json = null
    try {
        json = JSON.parse(text)
    } catch (e) {}

    return {
        status: res.status,
        headers: res.headers,
        text,
        json
    }
}

test("Gallery Batch Deletion: UI elements present in views/admin-gallery.html", () => {
    const html = fs.readFileSync(path.join(__dirname, "../views/admin-gallery.html"), "utf8")

    assert.ok(html.includes('id="btn-toggle-select-all"'), "Toolbar has Select All button")
    assert.ok(html.includes('id="btn-delete-selected"'), "Toolbar has Delete Selected button")
    assert.ok(html.includes('id="btn-delete-all"'), "Toolbar has Delete All button")
    assert.ok(html.includes('id="batch-delete-confirm-modal"'), "Has batch delete confirmation modal")
    assert.ok(html.includes('id="delete-all-confirm-modal"'), "Has delete all confirmation modal")
    assert.ok(html.includes('card-select-checkbox'), "Has card selection checkbox classes")
    assert.ok(html.includes('/admin/photo/delete-batch'), "Script calls /admin/photo/delete-batch")
})

test("Gallery Batch Deletion: Endpoint enforces CSRF and authentication", async () => {
    // 1. Unauthenticated request must return 401
    const unauthRes = await makeRequest("/admin/photo/delete-batch", {
        method: "POST",
        body: { filenames: ["secure_photo_fake.jpg"] }
    })
    assert.strictEqual(unauthRes.status, 401)

    // 2. Authenticated session without CSRF token must return 403
    const session = router.createSession("testadmin")
    const cookie = `sessionId=${session.id}`

    const noCsrfRes = await makeRequest("/admin/photo/delete-batch", {
        method: "POST",
        headers: { "Cookie": cookie },
        body: { filenames: ["secure_photo_fake.jpg"] }
    })
    assert.strictEqual(noCsrfRes.status, 403)
    assert.match(noCsrfRes.json.error, /CSRF/i)
})

test("Gallery Batch Deletion: Deletes selected filenames cleanly", async () => {
    const session = router.createSession("testadmin")
    const cookie = `sessionId=${session.id}`
    const csrfToken = router.getCsrfToken(session)

    // Upload 3 test photos
    for (let i = 0; i < 3; i++) {
        await makeRequest("/target/camera/upload", {
            method: "POST",
            body: { photos: [{ dataUrl: VALID_JPEG_DATA_URL }] }
        })
    }

    const listRes = await makeRequest("/admin/photos", {
        headers: { "Cookie": cookie, "Accept": "application/json" }
    })
    assert.strictEqual(listRes.status, 200)
    assert.ok(listRes.json.photos.length >= 3)

    const target1 = listRes.json.photos[0].filename
    const target2 = listRes.json.photos[1].filename

    // Verify files exist on disk
    assert.ok(fs.existsSync(path.join(config.uploadDir, target1)))
    assert.ok(fs.existsSync(path.join(config.uploadDir, target2)))

    // Batch delete 2 photos
    const batchDeleteRes = await makeRequest("/admin/photo/delete-batch", {
        method: "POST",
        headers: { "Cookie": cookie, "x-csrf-token": csrfToken },
        body: { filenames: [target1, target2] }
    })

    assert.strictEqual(batchDeleteRes.status, 200)
    assert.strictEqual(batchDeleteRes.json.success, true)
    assert.strictEqual(batchDeleteRes.json.deletedCount, 2)

    // Verify unlinked from disk
    assert.strictEqual(fs.existsSync(path.join(config.uploadDir, target1)), false)
    assert.strictEqual(fs.existsSync(path.join(config.uploadDir, target2)), false)
})

test("Gallery Batch Deletion: Delete All clears all stored photos", async () => {
    const session = router.createSession("testadmin")
    const cookie = `sessionId=${session.id}`
    const csrfToken = router.getCsrfToken(session)

    // Upload test photos
    for (let i = 0; i < 2; i++) {
        await makeRequest("/target/camera/upload", {
            method: "POST",
            body: { photos: [{ dataUrl: VALID_JPEG_DATA_URL }] }
        })
    }

    // Call deleteAll: true
    const deleteAllRes = await makeRequest("/admin/photo/delete-batch", {
        method: "POST",
        headers: { "Cookie": cookie, "x-csrf-token": csrfToken },
        body: { deleteAll: true }
    })

    assert.strictEqual(deleteAllRes.status, 200)
    assert.strictEqual(deleteAllRes.json.success, true)
    assert.strictEqual(deleteAllRes.json.remainingCount, 0)

    // Catalog must now be empty
    const listRes = await makeRequest("/admin/photos", {
        headers: { "Cookie": cookie, "Accept": "application/json" }
    })
    assert.strictEqual(listRes.json.count, 0)
    assert.strictEqual(listRes.json.photos.length, 0)
})
