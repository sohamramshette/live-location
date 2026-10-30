const fs = require("fs")
const path = require("path")

// Automatically load .env if present in current working directory
const envPath = path.resolve(process.cwd(), ".env")
if (fs.existsSync(envPath)) {
    try {
        if (typeof process.loadEnvFile === "function") {
            process.loadEnvFile(envPath)
        } else {
            const content = fs.readFileSync(envPath, "utf8")
            for (const line of content.split(/\r?\n/)) {
                const trimmed = line.trim()
                if (!trimmed || trimmed.startsWith("#")) continue
                const eqIdx = trimmed.indexOf("=")
                if (eqIdx !== -1) {
                    const key = trimmed.slice(0, eqIdx).trim()
                    let val = trimmed.slice(eqIdx + 1).trim()
                    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
                        val = val.slice(1, -1)
                    }
                    if (process.env[key] === undefined) {
                        process.env[key] = val
                    }
                }
            }
        }
    } catch (err) {
        console.warn("[WARN] Could not parse .env file:", err.message)
    }
}

const NODE_ENV = process.env.NODE_ENV || "development"
const isProduction = NODE_ENV === "production"

const port = parseInt(process.env.PORT, 10) || 6589
const username = process.env.ADMIN_USERNAME || (isProduction ? "" : "admin")
const password = process.env.ADMIN_PASSWORD || (isProduction ? "" : "admin")
const sessionSecret = process.env.SESSION_SECRET || (isProduction ? "" : "dev_session_secret_f7e912a5c43d8b0e61fa2b7c4e9d30_insecure")
const sessionTtlHours = parseInt(process.env.SESSION_TTL_HOURS, 10) || 12
const sessionTtlMs = sessionTtlHours * 60 * 60 * 1000

const trustProxy = process.env.TRUST_PROXY === "true"
    ? true
    : (process.env.TRUST_PROXY === "false" || !process.env.TRUST_PROXY ? false : process.env.TRUST_PROXY)

const enableTunnel = process.env.ENABLE_TUNNEL !== undefined
    ? process.env.ENABLE_TUNNEL === "true"
    : true

const uploadDir = process.env.UPLOAD_DIR
    ? path.resolve(process.cwd(), process.env.UPLOAD_DIR)
    : path.join(__dirname, "storage", "uploads")

const maxStorageMb = parseInt(process.env.MAX_STORAGE_MB, 10) || 500
const maxStorageBytes = maxStorageMb * 1024 * 1024
const maxUploadSizeMb = parseInt(process.env.MAX_UPLOAD_SIZE_MB, 10) || 5
const maxUploadSizeBytes = maxUploadSizeMb * 1024 * 1024
const maxPhotosPerBatch = parseInt(process.env.MAX_PHOTOS_PER_BATCH, 10) || 10
const rateLimitMax = parseInt(process.env.RATE_LIMIT_MAX, 10) || 15
const rateLimitWindowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 60000

function validateConfig() {
    const errors = []

    if (isProduction) {
        if (!username || username.trim().length < 3) {
            errors.push("ADMIN_USERNAME must be set and at least 3 characters long.")
        }
        if (!password || password.trim().length < 8) {
            errors.push("ADMIN_PASSWORD must be set and at least 8 characters long.")
        }
        if (password === "admin" || password === "password" || password === "12345678") {
            errors.push("ADMIN_PASSWORD must not be a common or default password.")
        }
        if (!sessionSecret || sessionSecret.length < 32 || sessionSecret.startsWith("dev_session_secret")) {
            errors.push("SESSION_SECRET must be set to a strong random secret (minimum 32 characters) in production.")
        }
    } else {
        if (username === "admin" && password === "admin") {
            console.warn("[WARN] Running with default development credentials (admin/admin). Set ADMIN_USERNAME and strong ADMIN_PASSWORD before deploying to production.")
        }
        if (sessionSecret.startsWith("dev_session_secret")) {
            console.warn("[WARN] Running with default development SESSION_SECRET. Provide a unique 32+ character random secret before deploying to production.")
        }
    }

    if (errors.length > 0) {
        console.error("\n=======================================================")
        console.error("[FATAL] Production Configuration Validation Failed:")
        errors.forEach(err => console.error(`  - ${err}`))
        console.error("Please configure the required environment variables in .env or the system environment.")
        console.error("=======================================================\n")
        process.exit(1)
    }
}

module.exports = {
    env: NODE_ENV,
    isProduction,
    port,
    username,
    password,
    sessionSecret,
    sessionTtlHours,
    sessionTtlMs,
    trustProxy,
    enableTunnel,
    uploadDir,
    maxStorageMb,
    maxStorageBytes,
    maxUploadSizeMb,
    maxUploadSizeBytes,
    maxPhotosPerBatch,
    rateLimitMax,
    rateLimitWindowMs,
    validateConfig,

    // Backward compatibility getters
    get token() {
        return sessionSecret
    }
}