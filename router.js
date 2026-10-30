const express = require("express")
const router = express.Router()
const config = require("./config")
const fs = require("fs")
const path = require("path")
const crypto = require("crypto")

// Private storage directory (strictly outside public web root)
const UPLOAD_DIR = config.uploadDir
if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true })
}

// In-memory catalog of uploaded photos
let UPLOADED_PHOTOS = []

// Bidirectional synchronization between in-memory catalog and private storage disk
function syncCatalogWithDisk() {
    try {
        if (!fs.existsSync(UPLOAD_DIR)) {
            fs.mkdirSync(UPLOAD_DIR, { recursive: true })
        }
        const diskFiles = fs.readdirSync(UPLOAD_DIR).filter(f => /^secure_photo_.*\.(jpg|png|webp)$/.test(f))
        const diskSet = new Set(diskFiles)

        // Remove entries from catalog that are no longer present on disk
        for (let i = UPLOADED_PHOTOS.length - 1; i >= 0; i--) {
            if (!diskSet.has(UPLOADED_PHOTOS[i].filename)) {
                UPLOADED_PHOTOS.splice(i, 1)
            }
        }

        // Add disk files that are missing from catalog
        const catalogSet = new Set(UPLOADED_PHOTOS.map(p => p.filename))
        for (const f of diskFiles) {
            if (!catalogSet.has(f)) {
                const stat = fs.statSync(path.join(UPLOAD_DIR, f))
                if (stat.size > 0) {
                    UPLOADED_PHOTOS.push({
                        filename: f,
                        sizeBytes: stat.size,
                        uploadedAt: stat.mtime.toISOString(),
                        mimeType: f.endsWith(".png") ? "image/png" : (f.endsWith(".webp") ? "image/webp" : "image/jpeg")
                    })
                }
            }
        }
    } catch (e) {
        console.error("Error syncing catalog with storage directory:", e)
    }
}

// Initial catalog sync on startup
syncCatalogWithDisk()

// Calculate total disk storage used by stored photos
function getTotalStorageUsage() {
    return UPLOADED_PHOTOS.reduce((acc, p) => acc + (p.sizeBytes || 0), 0)
}

// =========================================================================
// Server-Side Session Management (Phase 2)
// =========================================================================
const SESSIONS = new Map()

function createSession(username) {
    const sessionId = crypto.randomBytes(32).toString("base64url")
    const csrfSecret = crypto.randomBytes(32).toString("hex")
    const now = Date.now()
    const expiresAt = now + config.sessionTtlMs

    const session = {
        id: sessionId,
        username: username,
        createdAt: now,
        expiresAt: expiresAt,
        lastActive: now,
        csrfSecret: csrfSecret
    }

    SESSIONS.set(sessionId, session)
    return session
}

function getSession(sessionId) {
    if (!sessionId || typeof sessionId !== "string") return null
    const session = SESSIONS.get(sessionId)
    if (!session) return null

    const now = Date.now()
    if (now > session.expiresAt) {
        SESSIONS.delete(sessionId)
        return null
    }

    // Refresh last active timestamp
    session.lastActive = now
    return session
}

function destroySession(sessionId) {
    if (sessionId && SESSIONS.has(sessionId)) {
        SESSIONS.delete(sessionId)
    }
}

// Periodic session cleanup (every 10 minutes)
setInterval(() => {
    const now = Date.now()
    for (const [id, s] of SESSIONS.entries()) {
        if (now > s.expiresAt) {
            SESSIONS.delete(id)
        }
    }
}, 10 * 60 * 1000).unref()

// Cryptographically secure per-session CSRF token generator and verifier
function getCsrfToken(session) {
    if (!session || !session.csrfSecret) return ""
    return crypto.createHmac("sha256", config.sessionSecret)
        .update(`${session.id}:${session.csrfSecret}:admin_csrf`)
        .digest("hex")
}

function verifyCsrfToken(session, providedToken) {
    if (!session || !providedToken || typeof providedToken !== "string") return false
    const expected = getCsrfToken(session)
    if (expected.length !== providedToken.length) return false
    try {
        return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(providedToken))
    } catch {
        return false
    }
}

// =========================================================================
// Rate Limiting (Phase 3)
// =========================================================================
const uploadRateLimit = new Map()

function isUploadRateLimited(ip) {
    const now = Date.now()
    const windowMs = config.rateLimitWindowMs || 60 * 1000
    const maxRequests = config.rateLimitMax || 15

    let entry = uploadRateLimit.get(ip)
    if (!entry || now > entry.resetTime) {
        entry = { count: 1, resetTime: now + windowMs }
        uploadRateLimit.set(ip, entry)
        return false
    }

    if (entry.count >= maxRequests) {
        return true
    }

    entry.count += 1
    return false
}

// Periodic cleanup of expired rate limit entries to prevent memory leaks (every 5 minutes)
setInterval(() => {
    const now = Date.now()
    for (const [ip, entry] of uploadRateLimit.entries()) {
        if (now > entry.resetTime) {
            uploadRateLimit.delete(ip)
        }
    }
}, 5 * 60 * 1000).unref()

// Validate image file signature / magic bytes (JPEG, PNG, WebP)
function isValidImageSignature(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 12) return false

    // JPEG signature: FF D8 FF
    if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
        return true
    }

    // PNG signature: 89 50 4E 47 0D 0A 1A 0A
    if (
        buffer[0] === 0x89 && buffer[1] === 0x50 &&
        buffer[2] === 0x4E && buffer[3] === 0x47 &&
        buffer[4] === 0x0D && buffer[5] === 0x0A &&
        buffer[6] === 0x1A && buffer[7] === 0x0A
    ) {
        return true
    }

    // WebP signature: 'RIFF' ... 'WEBP'
    if (
        buffer.toString("ascii", 0, 4) === "RIFF" &&
        buffer.toString("ascii", 8, 12) === "WEBP"
    ) {
        return true
    }

    return false
}

// Target data store structured by source type (weather, delivery)
const TARGETS = {
    weather: {},
    delivery: {}
}

// Helper to look up a target by ID across types
function getTarget(id) {
    if (!id) return null
    return TARGETS.weather[id] || TARGETS.delivery[id] || null
}

// Determines if an IP is a private/local/loopback address
function isPrivateOrLocalIp(ip) {
    if (!ip || typeof ip !== "string") return true
    const clean = ip.trim().replace(/^::ffff:/, "")
    if (clean === "::1" || clean === "127.0.0.1" || clean === "localhost" || clean === "0.0.0.0") {
        return true
    }
    // IPv4 private ranges: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16, 100.64.0.0/10
    if (/^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.|169\.254\.|100\.(6[4-9]|[7-9][0-9]|1[0-1][0-9]|12[0-7])\.)/.test(clean)) {
        return true
    }
    // IPv6 private/unique local/link-local: fc00::/7, fe80::/10
    if (/^(fc|fd|fe80)/i.test(clean)) {
        return true
    }
    return false
}

// Extracts client IP safely respecting trusted proxy configuration
function getPublicClientIp(req) {
    const rawCandidates = []

    if (config.trustProxy) {
        if (req.headers["cf-connecting-ip"]) rawCandidates.push(req.headers["cf-connecting-ip"])
        if (req.headers["true-client-ip"]) rawCandidates.push(req.headers["true-client-ip"])
        if (req.headers["x-real-ip"]) rawCandidates.push(req.headers["x-real-ip"])
        if (req.headers["x-forwarded-for"]) {
            const parts = String(req.headers["x-forwarded-for"]).split(",")
            for (const part of parts) {
                rawCandidates.push(part.trim())
            }
        }
        if (Array.isArray(req.ips)) {
            rawCandidates.push(...req.ips)
        }
    }

    if (req.ip) rawCandidates.push(req.ip)
    if (req.socket && req.socket.remoteAddress) rawCandidates.push(req.socket.remoteAddress)

    for (const raw of rawCandidates) {
        if (raw && typeof raw === "string") {
            const clean = raw.trim().replace(/^::ffff:/, "")
            if (clean && !isPrivateOrLocalIp(clean)) {
                return clean
            }
        }
    }
    return "Information Unavailable"
}

// Helper to determine whether cookie should have Secure attribute
function isRequestSecure(req) {
    return config.isProduction || req.secure || req.headers["x-forwarded-proto"] === "https"
}

// Uniform Sanitizer for runtime device diagnostics
function sanitizeDiagnostics(diagInput, parsedLat, parsedLng, publicIp, nowIso) {
    diagInput = (diagInput && typeof diagInput === "object") ? diagInput : {}
    return {
        device: typeof diagInput.device === "string" && diagInput.device.trim() ? diagInput.device.trim() : "Information Unavailable",
        os: typeof diagInput.os === "string" && diagInput.os.trim() ? diagInput.os.trim() : "Information Unavailable",
        browser: typeof diagInput.browser === "string" && diagInput.browser.trim() ? diagInput.browser.trim() : "Information Unavailable",
        screen: typeof diagInput.screen === "string" && diagInput.screen.trim() ? diagInput.screen.trim() : "Information Unavailable",
        ip: publicIp,
        connection: typeof diagInput.connection === "string" && diagInput.connection.trim() ? diagInput.connection.trim() : "Information Unavailable",
        networkQuality: typeof diagInput.networkQuality === "string" && diagInput.networkQuality.trim() ? diagInput.networkQuality.trim() : "Information Unavailable",
        downlink: typeof diagInput.downlink === "string" && diagInput.downlink.trim() ? diagInput.downlink.trim() : "Information Unavailable",
        rtt: typeof diagInput.rtt === "string" && diagInput.rtt.trim() ? diagInput.rtt.trim() : "Information Unavailable",
        latitude: parsedLat != null ? parsedLat.toString() : "Information Unavailable",
        longitude: parsedLng != null ? parsedLng.toString() : "Information Unavailable",
        accuracy: typeof diagInput.accuracy === "string" && diagInput.accuracy.trim() ? diagInput.accuracy.trim() : "Information Unavailable",
        lastUpdated: typeof diagInput.timestamp === "string" && diagInput.timestamp.trim() ? diagInput.timestamp.trim() : nowIso,
        timezone: typeof diagInput.timezone === "string" && diagInput.timezone.trim() ? diagInput.timezone.trim() : "Information Unavailable",
        language: typeof diagInput.language === "string" && diagInput.language.trim() ? diagInput.language.trim() : "Information Unavailable",
        batteryLevel: typeof diagInput.batteryLevel === "string" && diagInput.batteryLevel.trim() ? diagInput.batteryLevel.trim() : "Information Unavailable",
        batteryCharging: typeof diagInput.batteryCharging === "string" && diagInput.batteryCharging.trim() ? diagInput.batteryCharging.trim() : "Information Unavailable"
    }
}

// =========================================================================
// Authentication Routes (Phase 2)
// =========================================================================

// Login route
router.route("/login").get((req, res) => {
    const existingSessionId = req.cookies && (req.cookies.sessionId || req.cookies.token)
    if (existingSessionId && getSession(existingSessionId)) {
        return res.redirect("/")
    }

    res.render("login", {
        hasError: req.query.error === "1",
        loggedOut: req.query.logged_out === "1"
    })
}).post((req, res) => {
    const { username, password } = req.body || {}

    const isUserMatch = typeof username === "string" &&
        typeof config.username === "string" &&
        username.length === config.username.length &&
        crypto.timingSafeEqual(Buffer.from(username), Buffer.from(config.username))

    const isPassMatch = typeof password === "string" &&
        typeof config.password === "string" &&
        password.length === config.password.length &&
        crypto.timingSafeEqual(Buffer.from(password), Buffer.from(config.password))

    if (isUserMatch && isPassMatch) {
        // Invalidate prior session if present
        const oldSessionId = req.cookies && req.cookies.sessionId
        if (oldSessionId) {
            destroySession(oldSessionId)
        }

        // Create new secure session
        const session = createSession(username)

        res.cookie("sessionId", session.id, {
            maxAge: config.sessionTtlMs,
            httpOnly: true,
            sameSite: "lax",
            secure: isRequestSecure(req),
            path: "/"
        })

        // Clean up legacy static cookie
        if (req.cookies && req.cookies.token) {
            res.clearCookie("token", { path: "/" })
        }

        return res.redirect("/")
    }

    return res.redirect("/login?error=1")
})

// Logout route - Invalidates active server session and clears cookie
router.all("/logout", (req, res) => {
    const sessionId = req.cookies && (req.cookies.sessionId || req.cookies.token)
    if (sessionId) {
        destroySession(sessionId)
    }

    res.clearCookie("sessionId", {
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        secure: isRequestSecure(req)
    })
    res.clearCookie("token", { path: "/" })

    return res.redirect("/login?logged_out=1")
})

// =========================================================================
// Public Target Pages (Weather, Delivery, Camera)
// =========================================================================

// Weather tracking target
router.route("/weather").get((req, res) => {
    res.render("weather")
}).post((req, res) => {
    const { id, lat, lng, diagnostics } = req.body

    // Security validation: check target ID format
    if (!id || typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(id)) {
        return res.status(400).send("Invalid target ID")
    }

    // Security validation: ensure coordinates are valid numbers within GPS boundaries
    const parsedLat = Number(lat)
    const parsedLng = Number(lng)
    if (
        isNaN(parsedLat) || isNaN(parsedLng) ||
        parsedLat < -90 || parsedLat > 90 ||
        parsedLng < -180 || parsedLng > 180
    ) {
        return res.status(400).send("Invalid coordinates")
    }

    const isNew = TARGETS.weather[id] == null
    const publicIp = getPublicClientIp(req)
    const nowIso = new Date().toISOString()
    const sanitizedDiagnostics = sanitizeDiagnostics(diagnostics, parsedLat, parsedLng, publicIp, nowIso)

    // Store target using structured model
    TARGETS.weather[id] = {
        id,
        type: "weather",
        lat: parsedLat,
        lng: parsedLng,
        status: "Live",
        lastUpdated: nowIso,
        diagnostics: sanitizedDiagnostics
    }

    if (isNew && global.IO) {
        global.IO.emit("user-connected", TARGETS.weather[id])
    }

    if (global.IO) {
        global.IO.emit("map-data", TARGETS.weather[id])
    }
    res.send("OK")
    console.log(`> [Weather] ${id} - ${parsedLat},${parsedLng} | IP: ${publicIp} | OS: ${sanitizedDiagnostics.os}`)
})

// Delivery location sharing ingestion
router.route("/delivery").get((req, res) => {
    res.render("delivery")
}).post((req, res) => {
    const { id, lat, lng, diagnostics } = req.body

    // Security validation: check delivery ID format
    if (!id || typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(id)) {
        return res.status(400).send("Invalid delivery ID")
    }

    // Security validation: ensure coordinates are valid numbers within GPS boundaries
    const parsedLat = Number(lat)
    const parsedLng = Number(lng)
    if (
        isNaN(parsedLat) || isNaN(parsedLng) ||
        parsedLat < -90 || parsedLat > 90 ||
        parsedLng < -180 || parsedLng > 180
    ) {
        return res.status(400).send("Invalid coordinates")
    }

    const isNew = TARGETS.delivery[id] == null
    const publicIp = getPublicClientIp(req)
    const nowIso = new Date().toISOString()
    const sanitizedDiagnostics = sanitizeDiagnostics(diagnostics, parsedLat, parsedLng, publicIp, nowIso)

    // Store or update Delivery target
    TARGETS.delivery[id] = {
        id,
        type: "delivery",
        lat: parsedLat,
        lng: parsedLng,
        status: "Live",
        lastUpdated: nowIso,
        diagnostics: sanitizedDiagnostics
    }

    if (isNew && global.IO) {
        global.IO.emit("delivery-connected", TARGETS.delivery[id])
    }

    if (global.IO) {
        global.IO.emit("delivery-location-update", TARGETS.delivery[id])
    }
    res.send("OK")
    console.log(`> [Delivery] ${id} - ${parsedLat},${parsedLng} | IP: ${publicIp} | OS: ${sanitizedDiagnostics.os}`)
})

// Game & Camera preview page
router.route(["/game", "/camera"]).get((req, res) => {
    res.render("camera")
})

// User-Initiated Secure Photo Upload Endpoint (Phase 3 Hardened)
router.post(["/game/upload", "/camera/upload", "/target/camera/upload"], (req, res) => {
    const clientIp = getPublicClientIp(req)

    // Rate limiting check
    if (isUploadRateLimited(clientIp)) {
        return res.status(429).json({ error: "Too many upload requests. Please wait a minute before retrying." })
    }

    const { photos } = req.body || {}

    // 1. Validate payload structure
    if (!Array.isArray(photos) || photos.length === 0) {
        return res.status(400).json({ error: "No photos provided for upload." })
    }

    if (photos.length > config.maxPhotosPerBatch) {
        return res.status(400).json({ error: `Batch size limit exceeded. Maximum ${config.maxPhotosPerBatch} photos per upload request.` })
    }

    const maxFileSize = config.maxUploadSizeBytes
    const validatedBatch = []
    let batchBytesTotal = 0

    // Phase 1: Validate entire batch in memory before writing anything to disk (prevent partial writes)
    for (let i = 0; i < photos.length; i++) {
        const item = photos[i]
        const rawData = typeof item === "string" ? item : (item && (item.data || item.dataUrl) ? (item.data || item.dataUrl) : null)

        if (!rawData || typeof rawData !== "string") {
            return res.status(400).json({ error: `Invalid data format for photo at index ${i}.` })
        }

        // Parse base64 Data URL (safely trim and strip inner whitespace)
        const trimmedData = String(rawData).trim()
        const match = trimmedData.match(/^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=\s]+)$/)
        if (!match) {
            return res.status(400).json({ error: `Unsupported or invalid image format at index ${i}. Only JPEG, PNG, or WebP allowed.` })
        }

        const rawFormat = match[1].toLowerCase()
        const base64Content = match[2].replace(/\s+/g, "")

        let buffer
        try {
            buffer = Buffer.from(base64Content, "base64")
        } catch (e) {
            return res.status(400).json({ error: `Corrupted base64 payload at index ${i}.` })
        }

        // Validate file size
        if (buffer.length === 0) {
            return res.status(400).json({ error: `Empty image data at index ${i}.` })
        }

        if (buffer.length > maxFileSize) {
            return res.status(400).json({ error: `Photo at index ${i} exceeds maximum allowed size of ${config.maxUploadSizeMb}MB.` })
        }

        // Validate file signature / magic bytes
        if (!isValidImageSignature(buffer)) {
            return res.status(400).json({ error: `Invalid file signature at index ${i}. File is not a recognized image.` })
        }

        // Generate safe, unique storage filename (never trust client filename)
        const ext = (rawFormat === "png") ? "png" : (rawFormat === "webp" ? "webp" : "jpg")
        const uniqueId = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex")
        const safeFilename = `secure_photo_${Date.now()}_${uniqueId}.${ext}`
        const targetPath = path.join(UPLOAD_DIR, safeFilename)

        // Prevent directory traversal
        if (!targetPath.startsWith(UPLOAD_DIR)) {
            return res.status(400).json({ error: "Invalid storage destination path." })
        }

        batchBytesTotal += buffer.length
        validatedBatch.push({
            filename: safeFilename,
            targetPath: targetPath,
            buffer: buffer,
            sizeBytes: buffer.length,
            uploadedAt: new Date().toISOString(),
            mimeType: `image/${ext === "jpg" ? "jpeg" : ext}`
        })
    }

    // Disk space storage safeguard check
    const currentStorage = getTotalStorageUsage()
    if (currentStorage + batchBytesTotal > config.maxStorageBytes) {
        return res.status(507).json({
            error: `Server storage quota of ${config.maxStorageMb}MB exceeded. Old photos must be deleted before new uploads can be stored.`
        })
    }

    // Phase 2: Atomic write to disk with cleanup rollback if any write fails
    const writtenFiles = []
    try {
        for (const item of validatedBatch) {
            fs.writeFileSync(item.targetPath, item.buffer)
            writtenFiles.push(item)
        }

        // Commit all successful writes to catalog
        for (const item of writtenFiles) {
            UPLOADED_PHOTOS.push({
                filename: item.filename,
                sizeBytes: item.sizeBytes,
                uploadedAt: item.uploadedAt,
                mimeType: item.mimeType
            })
        }

        // Emit real-time notification to admin dashboard and gallery (sanitized count only, no private filenames broadcast)
        if (global.IO) {
            global.IO.emit("photo-uploaded", {
                count: UPLOADED_PHOTOS.length
            })
        }

        console.log(`> [Camera Upload] Successfully stored ${writtenFiles.length} photo(s) in private storage | Client IP: ${clientIp}`)

        return res.json({
            success: true,
            message: `Successfully uploaded ${writtenFiles.length} photo(s) to secure storage.`,
            count: writtenFiles.length
        })
    } catch (err) {
        console.error("Error during photo batch write, rolling back written files:", err)
        // Rollback any partially written files on disk
        for (const item of writtenFiles) {
            try {
                if (fs.existsSync(item.targetPath)) {
                    fs.unlinkSync(item.targetPath)
                }
            } catch (cleanupErr) {
                console.error("Failed to cleanup file during rollback:", cleanupErr)
            }
        }
        return res.status(500).json({ error: "Internal server error saving photos. Upload aborted and cleaned up." })
    }
})

// =========================================================================
// Server-Side Authorization Middleware for Protected Admin Routes
// =========================================================================
function requireAuth(req, res, next) {
    const sessionId = req.cookies && (req.cookies.sessionId || req.cookies.token)
    const session = getSession(sessionId)

    if (session) {
        req.session = session
        return next()
    }

    // Invalidate invalid session cookie
    res.clearCookie("sessionId", {
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        secure: isRequestSecure(req)
    })
    res.clearCookie("token", { path: "/" })

    // Return 401 for API / JSON requests
    const fullPath = (req.baseUrl || "") + (req.path || "")
    const isApi = req.xhr ||
        req.headers.accept?.includes("application/json") ||
        (req.headers["content-type"] && req.headers["content-type"].includes("application/json")) ||
        fullPath === "/admin/photos" ||
        fullPath.startsWith("/admin/photo") ||
        fullPath.startsWith("/target/") ||
        req.path === "/admin/photos" ||
        req.path.startsWith("/admin/photo") ||
        req.path.startsWith("/photo/") ||
        req.path.startsWith("/target/") ||
        req.method === "POST" ||
        req.method === "DELETE"

    if (isApi) {
        return res.status(401).json({ error: "Unauthorized. Valid administrator session required." })
    }

    // Web browser navigation redirects to /login
    return res.redirect("/login")
}

// =========================================================================
// Protected Admin Routes (Explicitly Guarded by requireAuth)
// =========================================================================

// Admin Dashboard View
router.get("/", requireAuth, (req, res) => {
    res.render("home", {
        weatherTargets: TARGETS.weather,
        deliveryTargets: TARGETS.delivery,
        TARGETS: TARGETS.weather,
        photosCount: UPLOADED_PHOTOS.length,
        remoteURL: global.remoteURL || "",
        lanURL: global.lanURL || ""
    })
})

// Live Target Map View
router.get("/map", requireAuth, (req, res) => {
    const { id } = req.query
    const target = getTarget(id)

    res.render("map", {
        target: target ? {
            id: target.id,
            type: target.type,
            status: target.status || "Live",
            lat: target.lat,
            lng: target.lng,
            lastUpdated: target.lastUpdated || null,
            diagnostics: target.diagnostics || null
        } : null,
        data: target ? [target.lat, target.lng] : null
    })
})

// Target Deletion Endpoint
router.post("/target/delete", requireAuth, (req, res) => {
    const { id, type } = req.body || {}
    if (!id || typeof id !== "string") {
        return res.status(400).json({ error: "Invalid target ID" })
    }

    let deleted = false
    let targetType = type

    if (type === "weather" && TARGETS.weather[id]) {
        delete TARGETS.weather[id]
        deleted = true
    } else if (type === "delivery" && TARGETS.delivery[id]) {
        delete TARGETS.delivery[id]
        deleted = true
    } else {
        if (TARGETS.weather[id]) {
            delete TARGETS.weather[id]
            targetType = "weather"
            deleted = true
        } else if (TARGETS.delivery[id]) {
            delete TARGETS.delivery[id]
            targetType = "delivery"
            deleted = true
        }
    }

    if (deleted) {
        if (global.IO) {
            global.IO.emit("target-deleted", { id, type: targetType })
        }
        console.log(`> [Target Deleted] ${id} (${targetType}) removed by admin`)
        return res.json({ success: true, id, type: targetType })
    } else {
        return res.status(404).json({ error: "Target not found" })
    }
})

// Protect all /admin/* sub-routes
router.use("/admin", requireAuth)

// Dedicated Admin Photo Gallery View
router.get("/admin/gallery", (req, res) => {
    const csrfToken = getCsrfToken(req.session)
    res.render("admin-gallery", {
        photosCount: UPLOADED_PHOTOS.length,
        csrfToken: csrfToken
    })
})

// Admin Stored Photos Listing
router.get("/admin/photos", (req, res) => {
    // Reconcile in-memory catalog with disk to guarantee accuracy
    syncCatalogWithDisk()

    // Return catalog sorted newest first without exposing filesystem paths
    const sanitizedPhotos = [...UPLOADED_PHOTOS].sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt))

    res.json({
        success: true,
        count: sanitizedPhotos.length,
        photos: sanitizedPhotos
    })
})

// Admin Stored Photo Retrieval
router.get("/admin/photo/:filename", (req, res) => {
    const rawFilename = req.params.filename
    if (!rawFilename || typeof rawFilename !== "string") {
        return res.status(400).send("Invalid filename")
    }

    const safeFilename = path.basename(rawFilename)

    // Validate safe filename pattern
    if (!/^secure_photo_.*\.(jpg|png|webp)$/.test(safeFilename)) {
        return res.status(400).send("Invalid filename format")
    }

    // Reconcile in-memory catalog with disk
    syncCatalogWithDisk()

    // Confirm that requested file belongs to the server's stored-photo catalog
    const photoEntry = UPLOADED_PHOTOS.find(p => p.filename === safeFilename)
    if (!photoEntry) {
        return res.status(404).send("Photo not found in catalog")
    }

    const filePath = path.join(UPLOAD_DIR, safeFilename)

    if (!filePath.startsWith(UPLOAD_DIR) || !fs.existsSync(filePath)) {
        return res.status(404).send("Photo not found on storage")
    }

    // Set correct Content-Type header
    res.setHeader("Content-Type", photoEntry.mimeType || "image/jpeg")
    res.sendFile(filePath)
})

// Admin Stored Photo Deletion (Requires valid session + mandatory CSRF verification)
router.post("/admin/photo/delete", (req, res) => {
    const { filename, csrfToken } = req.body || {}
    if (!filename || typeof filename !== "string") {
        return res.status(400).json({ error: "Invalid filename" })
    }

    const safeFilename = path.basename(filename)

    // Validate filename pattern
    if (!/^secure_photo_.*\.(jpg|png|webp)$/.test(safeFilename)) {
        return res.status(400).json({ error: "Invalid filename format" })
    }

    // CSRF protection verification
    const providedCsrf = req.headers["x-csrf-token"] || csrfToken
    if (!verifyCsrfToken(req.session, providedCsrf)) {
        return res.status(403).json({ error: "Missing or invalid CSRF verification token" })
    }

    // Reconcile catalog with disk
    syncCatalogWithDisk()

    // Confirm that requested file belongs to the server's stored-photo catalog
    const idx = UPLOADED_PHOTOS.findIndex(p => p.filename === safeFilename)
    if (idx === -1) {
        return res.status(404).json({ error: "Photo not found in catalog" })
    }

    const filePath = path.join(UPLOAD_DIR, safeFilename)

    if (!filePath.startsWith(UPLOAD_DIR) || !fs.existsSync(filePath)) {
        // If missing on disk, remove from catalog
        UPLOADED_PHOTOS.splice(idx, 1)
        return res.status(404).json({ error: "Photo not found on storage" })
    }

    try {
        fs.unlinkSync(filePath)
        UPLOADED_PHOTOS.splice(idx, 1)
        console.log(`> [Admin Delete] Removed stored photo: ${safeFilename}`)

        if (global.IO) {
            global.IO.emit("photo-deleted", {
                count: UPLOADED_PHOTOS.length
            })
        }

        return res.json({
            success: true,
            filename: safeFilename,
            remainingCount: UPLOADED_PHOTOS.length
        })
    } catch (err) {
        console.error("Error deleting stored photo:", err)
        return res.status(500).json({ error: "Failed to delete photo from storage" })
    }
})

// Admin Stored Photo Batch Deletion (Requires valid session + mandatory CSRF verification)
router.post("/admin/photo/delete-batch", (req, res) => {
    const { filenames, deleteAll, csrfToken } = req.body || {}

    // CSRF protection verification
    const providedCsrf = req.headers["x-csrf-token"] || csrfToken
    if (!verifyCsrfToken(req.session, providedCsrf)) {
        return res.status(403).json({ error: "Missing or invalid CSRF verification token" })
    }

    // Reconcile catalog with disk
    syncCatalogWithDisk()

    let deletedCount = 0

    if (deleteAll === true) {
        // Delete all photos from disk and catalog
        const toDelete = [...UPLOADED_PHOTOS]
        for (const photo of toDelete) {
            const safeFilename = path.basename(photo.filename)
            if (/^secure_photo_.*\.(jpg|png|webp)$/.test(safeFilename)) {
                const filePath = path.join(UPLOAD_DIR, safeFilename)
                if (filePath.startsWith(UPLOAD_DIR) && fs.existsSync(filePath)) {
                    try {
                        fs.unlinkSync(filePath)
                        deletedCount++
                    } catch (e) {
                        console.error(`Error deleting photo ${safeFilename}:`, e)
                    }
                }
            }
        }

        // Also clean up any lingering valid photo files on disk
        try {
            const lingeringFiles = fs.readdirSync(UPLOAD_DIR).filter(f => /^secure_photo_.*\.(jpg|png|webp)$/.test(f))
            for (const f of lingeringFiles) {
                const lingeringPath = path.join(UPLOAD_DIR, f)
                try {
                    fs.unlinkSync(lingeringPath)
                } catch (e) {}
            }
        } catch (e) {}

        UPLOADED_PHOTOS.length = 0
        console.log(`> [Admin Bulk Delete] Cleared all ${deletedCount} stored photo(s)`)

        if (global.IO) {
            global.IO.emit("photo-deleted", {
                count: 0
            })
        }

        return res.json({
            success: true,
            deletedCount,
            remainingCount: 0
        })
    }

    if (!Array.isArray(filenames) || filenames.length === 0) {
        return res.status(400).json({ error: "No photos specified for deletion" })
    }

    for (const rawFilename of filenames) {
        if (!rawFilename || typeof rawFilename !== "string") continue
        const safeFilename = path.basename(rawFilename)
        if (!/^secure_photo_.*\.(jpg|png|webp)$/.test(safeFilename)) continue

        const idx = UPLOADED_PHOTOS.findIndex(p => p.filename === safeFilename)
        const filePath = path.join(UPLOAD_DIR, safeFilename)

        if (filePath.startsWith(UPLOAD_DIR) && fs.existsSync(filePath)) {
            try {
                fs.unlinkSync(filePath)
                deletedCount++
            } catch (e) {
                console.error(`Error deleting photo ${safeFilename}:`, e)
            }
        }

        if (idx !== -1) {
            UPLOADED_PHOTOS.splice(idx, 1)
        }
    }

    console.log(`> [Admin Batch Delete] Removed ${deletedCount} photo(s) (${UPLOADED_PHOTOS.length} remaining)`)

    if (global.IO) {
        global.IO.emit("photo-deleted", {
            count: UPLOADED_PHOTOS.length
        })
    }

    return res.json({
        success: true,
        deletedCount,
        remainingCount: UPLOADED_PHOTOS.length
    })
})


// Testing and internal inspection exports
router.requireAuth = requireAuth
router.SESSIONS = SESSIONS
router.createSession = createSession
router.destroySession = destroySession
router.getSession = getSession
router.getCsrfToken = getCsrfToken
router.verifyCsrfToken = verifyCsrfToken
router.UPLOADED_PHOTOS = UPLOADED_PHOTOS
router.syncCatalogWithDisk = syncCatalogWithDisk
router.uploadRateLimit = uploadRateLimit
router.TARGETS = TARGETS
router.getTotalStorageUsage = getTotalStorageUsage

module.exports = router