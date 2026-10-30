const test = require("node:test")
const assert = require("node:assert")
const http = require("node:http")
const fs = require("node:fs")
const path = require("node:path")
const crypto = require("node:crypto")

// Ensure test environment variables
process.env.NODE_ENV = "test"
process.env.ENABLE_TUNNEL = "false"
process.env.ADMIN_USERNAME = "testadmin"
process.env.ADMIN_PASSWORD = "TestAdminStrongPassword123!"
process.env.SESSION_SECRET = "test_super_secret_session_key_with_at_least_32_characters_12345"
process.env.MAX_STORAGE_MB = "10"
process.env.RATE_LIMIT_MAX = "5"

const config = require("../config")
const router = require("../router")
const { app } = require("../server")

let testServer
let testBaseUrl

// Small sample valid JPEG image (1x1 pixel)
const VALID_JPEG_BASE64 = "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA="
const VALID_JPEG_DATA_URL = `data:image/jpeg;base64,${VALID_JPEG_BASE64}`

// Sample valid PNG image (1x1 pixel)
const VALID_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
const VALID_PNG_DATA_URL = `data:image/png;base64,${VALID_PNG_BASE64}`

// Fake image with invalid signature
const FAKE_IMAGE_DATA_URL = "data:image/jpeg;base64,SGVsbG8gV29ybGQgbm90IGEgcmVhbCBpbWFnZQ=="

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

// Helper for making HTTP requests
async function makeRequest(path, options = {}) {
    const url = `${testBaseUrl}${path}`
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

// =============================================================================
// Phase 1: Environment and Secrets Tests
// =============================================================================
test("Phase 1: .gitignore excludes sensitive files and private uploads", () => {
    const gitignoreContent = fs.readFileSync(path.join(__dirname, "..", ".gitignore"), "utf8")
    assert.match(gitignoreContent, /\.env/, ".gitignore must exclude .env files")
    assert.match(gitignoreContent, /storage\/uploads\/\*/, ".gitignore must exclude uploaded files")
    assert.match(gitignoreContent, /!storage\/uploads\/\.gitkeep/, ".gitignore must preserve .gitkeep")
    assert.match(gitignoreContent, /logs\//, ".gitignore must exclude log directories")
})

test("Phase 1: .env.example exists and contains no production secrets", () => {
    const examplePath = path.join(__dirname, "..", ".env.example")
    assert.ok(fs.existsSync(examplePath), ".env.example must exist")
    const content = fs.readFileSync(examplePath, "utf8")
    assert.match(content, /ADMIN_USERNAME=/, "Contains ADMIN_USERNAME placeholder")
    assert.match(content, /ADMIN_PASSWORD=/, "Contains ADMIN_PASSWORD placeholder")
    assert.match(content, /SESSION_SECRET=/, "Contains SESSION_SECRET placeholder")
    assert.ok(!content.includes("ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb"), "Must not contain hardcoded token")
})

test("Phase 1: config module loads without errors and provides secure defaults", () => {
    assert.ok(config.sessionSecret, "Session secret must be present")
    assert.strictEqual(typeof config.validateConfig, "function", "validateConfig must be a function")
})

// =============================================================================
// Phase 2: Authentication and Session Security Tests
// =============================================================================
test("Phase 2: Unauthenticated requests to protected routes redirect or return 401", async () => {
    // Web route redirects to /login
    const homeRes = await makeRequest("/")
    assert.strictEqual(homeRes.status, 302)
    assert.strictEqual(homeRes.headers.get("location"), "/login")

    const galleryRes = await makeRequest("/admin/gallery")
    assert.strictEqual(galleryRes.status, 302)
    assert.strictEqual(galleryRes.headers.get("location"), "/login")

    // API route returns 401
    const photosRes = await makeRequest("/admin/photos", {
        headers: { "Accept": "application/json" }
    })
    assert.strictEqual(photosRes.status, 401)
    assert.ok(photosRes.json && photosRes.json.error)
})

test("Phase 2: Login rejects invalid credentials with redirect error", async () => {
    const res = await makeRequest("/login", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ username: "wronguser", password: "wrongpassword" }).toString()
    })
    assert.strictEqual(res.status, 302)
    assert.strictEqual(res.headers.get("location"), "/login?error=1")
})

test("Phase 2: Login with valid credentials issues unpredictable session cookie", async () => {
    const res = await makeRequest("/login", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ username: "testadmin", password: "TestAdminStrongPassword123!" }).toString()
    })

    assert.strictEqual(res.status, 302)
    assert.strictEqual(res.headers.get("location"), "/")

    const setCookie = res.headers.get("set-cookie")
    assert.ok(setCookie, "Set-Cookie header must be present")
    assert.match(setCookie, /sessionId=/, "Must set sessionId cookie")
    assert.match(setCookie, /HttpOnly/i, "Session cookie must have HttpOnly attribute")
    assert.match(setCookie, /SameSite=Lax/i, "Session cookie must have SameSite attribute")

    // Extract session ID and check unpredictability
    const match = setCookie.match(/sessionId=([^;]+)/)
    assert.ok(match && match[1], "Session ID must be extracted")
    const sessionId = match[1]
    assert.ok(sessionId.length >= 32, "Session ID must be sufficiently long and random")

    // Verify session works to access dashboard
    const authHomeRes = await makeRequest("/", {
        headers: { "Cookie": `sessionId=${sessionId}` }
    })
    assert.strictEqual(authHomeRes.status, 200)
    assert.ok(authHomeRes.text.includes("Live Location Tracker"))
})

test("Phase 2: Logout invalidates the session and clears session cookie", async () => {
    // 1. Create a session
    const session = router.createSession("testadmin")
    assert.ok(router.getSession(session.id), "Session must exist initially")

    // 2. Perform logout
    const logoutRes = await makeRequest("/logout", {
        method: "POST",
        headers: { "Cookie": `sessionId=${session.id}` }
    })

    assert.strictEqual(logoutRes.status, 302)
    assert.strictEqual(logoutRes.headers.get("location"), "/login?logged_out=1")

    // 3. Verify session was destroyed server-side
    assert.strictEqual(router.getSession(session.id), null, "Session must be removed from server store")

    // 4. Verify cookie clear header was sent
    const setCookie = logoutRes.headers.get("set-cookie")
    assert.ok(setCookie && setCookie.includes("sessionId=;"), "Cookie must be cleared")
})

// =============================================================================
// Phase 3: Upload and Storage Hardening Tests
// =============================================================================
test("Phase 3: Public photo upload accepts valid image and verifies magic bytes", async () => {
    const uploadRes = await makeRequest("/camera/upload", {
        method: "POST",
        body: {
            photos: [
                { data: VALID_JPEG_DATA_URL }
            ]
        }
    })

    assert.strictEqual(uploadRes.status, 200)
    assert.strictEqual(uploadRes.json.success, true)
    assert.strictEqual(uploadRes.json.count, 1)
})

test("Phase 3: Public photo upload rejects invalid magic bytes/signature", async () => {
    const fakeRes = await makeRequest("/camera/upload", {
        method: "POST",
        body: {
            photos: [
                { data: FAKE_IMAGE_DATA_URL }
            ]
        }
    })

    assert.strictEqual(fakeRes.status, 400)
    assert.match(fakeRes.json.error, /Invalid file signature/i)
})

test("Phase 3: Public photo upload rejects empty or oversized batches", async () => {
    // Empty photos array
    const emptyRes = await makeRequest("/camera/upload", {
        method: "POST",
        body: { photos: [] }
    })
    assert.strictEqual(emptyRes.status, 400)

    // Exceed max photos per batch (11 photos when limit is 10)
    const excessPhotos = Array(11).fill({ data: VALID_PNG_DATA_URL })
    const excessRes = await makeRequest("/camera/upload", {
        method: "POST",
        body: { photos: excessPhotos }
    })
    assert.strictEqual(excessRes.status, 400)
    assert.match(excessRes.json.error, /Batch size limit exceeded/i)
})

test("Phase 3: Protected photo deletion requires mandatory CSRF token", async () => {
    const session = router.createSession("testadmin")
    const cookie = `sessionId=${session.id}`

    // Upload an image first to get a real file in catalog
    await makeRequest("/camera/upload", {
        method: "POST",
        body: { photos: [{ data: VALID_JPEG_DATA_URL }] }
    })

    const photosRes = await makeRequest("/admin/photos", {
        headers: { "Cookie": cookie, "Accept": "application/json" }
    })
    assert.strictEqual(photosRes.status, 200)
    assert.ok(photosRes.json.photos.length > 0)
    const targetFile = photosRes.json.photos[0].filename

    // Attempt deletion WITHOUT CSRF token
    const noCsrfRes = await makeRequest("/admin/photo/delete", {
        method: "POST",
        headers: { "Cookie": cookie },
        body: { filename: targetFile }
    })
    assert.strictEqual(noCsrfRes.status, 403)
    assert.match(noCsrfRes.json.error, /CSRF/i)

    // Attempt deletion WITH valid CSRF token
    const validCsrf = router.getCsrfToken(session)
    const validDeleteRes = await makeRequest("/admin/photo/delete", {
        method: "POST",
        headers: { "Cookie": cookie, "x-csrf-token": validCsrf },
        body: { filename: targetFile }
    })
    assert.strictEqual(validDeleteRes.status, 200)
    assert.strictEqual(validDeleteRes.json.success, true)
})

// =============================================================================
// Phase 4: Production Configuration and Security Headers Tests
// =============================================================================
test("Phase 4: Health check endpoint /health returns 200 without exposing secrets", async () => {
    const healthRes = await makeRequest("/health")
    assert.strictEqual(healthRes.status, 200)
    assert.strictEqual(healthRes.json.status, "ok")
    assert.ok(typeof healthRes.json.uptime === "number")
    assert.strictEqual(healthRes.json.password, undefined)
    assert.strictEqual(healthRes.json.sessionSecret, undefined)
    assert.strictEqual(healthRes.json.adminPassword, undefined)
})

test("Phase 4: Security headers and Content Security Policy are present", async () => {
    const res = await makeRequest("/health")
    const csp = res.headers.get("content-security-policy")
    assert.ok(csp, "Content-Security-Policy header must be set")
    assert.match(csp, /default-src 'self'/, "CSP must contain default-src")
    assert.match(csp, /script-src/, "CSP must contain script-src")

    assert.strictEqual(res.headers.get("x-content-type-options"), "nosniff")
    assert.strictEqual(res.headers.get("x-frame-options"), "SAMEORIGIN")
    assert.strictEqual(res.headers.get("referrer-policy"), "strict-origin-when-cross-origin")
    assert.strictEqual(res.headers.get("x-powered-by"), null, "X-Powered-By should be removed")
})

test("Phase 4: Unmatched routes return safe 404 response", async () => {
    const res = await makeRequest("/non-existent-page-xyz-123")
    assert.strictEqual(res.status, 404)
})

// =============================================================================
// Public Target Ingestion & Diagnostics Tests
// =============================================================================
test("Public Target: Weather endpoint receives valid GPS and diagnostics", async () => {
    const res = await makeRequest("/weather", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            id: "test-target-weather-1",
            lat: "37.7749",
            lng: "-122.4194"
        }).toString()
    })
    assert.strictEqual(res.status, 200)
    assert.strictEqual(res.text, "OK")
})

test("Public Target: Delivery endpoint receives valid GPS and diagnostics", async () => {
    const res = await makeRequest("/delivery", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            id: "test-target-delivery-1",
            lat: "40.7128",
            lng: "-74.0060"
        }).toString()
    })
    assert.strictEqual(res.status, 200)
    assert.strictEqual(res.text, "OK")
})

test("Public Target: Coordinates boundary validation rejects invalid GPS", async () => {
    const res = await makeRequest("/weather", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            id: "invalid-target",
            lat: "999.0", // Exceeds 90
            lng: "0.0"
        }).toString()
    })
    assert.strictEqual(res.status, 400)
    assert.strictEqual(res.text, "Invalid coordinates")
})

test("Phase 3: Upload rate limiting blocks excessive requests (HTTP 429)", async () => {
    // Fill up the rate limit bucket for test client IP
    const testIp = "Information Unavailable"
    router.uploadRateLimit.set(testIp, { count: config.rateLimitMax, resetTime: Date.now() + 60000 })

    const rateLimitedRes = await makeRequest("/camera/upload", {
        method: "POST",
        body: { photos: [{ data: VALID_JPEG_DATA_URL }] }
    })

    assert.strictEqual(rateLimitedRes.status, 429)
    assert.match(rateLimitedRes.json.error, /Too many upload requests/i)

    // Reset rate limiter for subsequent tests
    router.uploadRateLimit.delete(testIp)
})

test("Phase 3: Storage quota safeguard rejects upload when limit is reached (HTTP 507)", async () => {
    // Temporarily simulate storage full by injecting a high usage or mock
    const originalQuota = config.maxStorageBytes
    config.maxStorageBytes = 50 // artificially low quota of 50 bytes

    const quotaRes = await makeRequest("/camera/upload", {
        method: "POST",
        body: { photos: [{ data: VALID_JPEG_DATA_URL }] }
    })

    assert.strictEqual(quotaRes.status, 507)
    assert.match(quotaRes.json.error, /storage.*exceeded/i)

    // Restore original quota
    config.maxStorageBytes = originalQuota
})

