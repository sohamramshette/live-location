const { tunnel: cloudflaredTunnel } = require("cloudflared")
const cookieParser = require("cookie-parser")
const socketIO = require("socket.io")
const config = require("./config")
const express = require("express")
const tarkine = require("tarkine")
const http = require("http")
const path = require("path")
const os = require("os")
const { execSync } = require("child_process")

// Validate configuration on startup
config.validateConfig()

const app = express()
const server = http.createServer(app)
const io = new socketIO.Server(server)
const PORT = process.env.PORT || config.port

global.remoteURL = ""
global.lanURL = ""
global.IO = io

// Disable fingerprinting header
app.disable("x-powered-by")

// Configure trusted proxy behavior explicitly
if (config.trustProxy) {
    app.set("trust proxy", config.trustProxy)
}

// Global Security Headers & Content Security Policy (CSP)
app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff")
    res.setHeader("X-Frame-Options", "SAMEORIGIN")
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin")
    res.setHeader("Permissions-Policy", "camera=(self), geolocation=(self), microphone=()")
    res.setHeader(
        "Content-Security-Policy",
        "default-src 'self'; " +
        "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://unpkg.com; " +
        "style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://unpkg.com; " +
        "img-src 'self' data: blob: https://*.tile.openstreetmap.org https://unpkg.com https://cdnjs.cloudflare.com; " +
        "font-src 'self' https://cdnjs.cloudflare.com; " +
        "connect-src 'self' ws: wss:; " +
        "media-src 'self' blob:; " +
        "object-src 'none'; " +
        "base-uri 'self'; " +
        "form-action 'self';"
    )
    next()
})

// Determine local LAN IP address for devices on same Wi-Fi / local network
function getLocalNetworkIp() {
    try {
        const interfaces = os.networkInterfaces()
        for (const name of Object.keys(interfaces)) {
            for (const iface of interfaces[name]) {
                if (iface.family === "IPv4" && !iface.internal) {
                    return iface.address
                }
            }
        }
    } catch (e) {}
    return null
}

const lanIp = getLocalNetworkIp()
if (lanIp) {
    global.lanURL = `http://${lanIp}:${PORT}`
}

app.set("views", path.join(__dirname, "views"))
app.set("view engine", "html")
app.engine("html", tarkine.renderFile)

// In development, reset template cache so edits to views reflect immediately on browser reload
if (process.env.NODE_ENV !== "production") {
    try {
        const tarkineHelpers = require("tarkine/src/helpers")
        app.use((req, res, next) => {
            if (tarkineHelpers && tarkineHelpers.caches) {
                tarkineHelpers.caches.__store = Object.create(null)
            }
            next()
        })
    } catch (e) {}
}

app.use(cookieParser())
app.use(express.urlencoded({ extended: false, limit: "25mb" }))
app.use(express.static(__dirname + "/public"))
app.use(express.json({ limit: "25mb" }))

// Phase 4: Production Health Check Endpoint (Reveals no secrets or internal system paths)
app.get("/health", (req, res) => {
    res.status(200).json({
        status: "ok",
        timestamp: new Date().toISOString(),
        uptime: Math.floor(process.uptime()),
        environment: config.env
    })
})

// Application Routes
app.use("/", require("./router"))

// Safe 404 Handler for unmatched routes
app.use((req, res) => {
    if (req.xhr || req.headers.accept?.includes("application/json")) {
        return res.status(404).json({ error: "Resource not found" })
    }
    res.status(404).send("404 Not Found")
})

// Safe 500 Error Handler (Prevents leakage of stack traces in production)
app.use((err, req, res, next) => {
    console.error("[ERROR] Internal request error:", err && err.message ? err.message : err)
    if (req.xhr || req.headers.accept?.includes("application/json")) {
        return res.status(500).json({ error: "An internal server error occurred." })
    }
    res.status(500).send("500 Internal Server Error")
})

server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
        console.error(`\n[ERROR] Port ${PORT} is already in use by another process.`)
        console.error(`To free the port on Windows, run: npm run kill-port`)
        console.error(`Or specify a custom port: PORT=8080 npm start\n`)
        process.exit(1)
    } else {
        console.error("[ERROR] Server error:", err)
    }
})

let tunnelInstance = null

function cleanup() {
    if (tunnelInstance) {
        try {
            if (typeof tunnelInstance.stop === "function") {
                tunnelInstance.stop()
            }
        } catch (e) {}
        try {
            if (tunnelInstance.child && tunnelInstance.child.pid) {
                execSync(`taskkill /pid ${tunnelInstance.child.pid} /T /F`, { stdio: "ignore" })
            }
        } catch (e) {}
        tunnelInstance = null
    }
}

let isShuttingDown = false

async function gracefulShutdown(signal) {
    if (isShuttingDown) return
    isShuttingDown = true
    console.log(`\n[SHUTDOWN] Received ${signal}. Starting graceful shutdown...`)

    const forceExitTimeout = setTimeout(() => {
        console.error("[SHUTDOWN] Shutdown timed out after 5s. Forcing exit.")
        process.exit(1)
    }, 5000)
    forceExitTimeout.unref()

    cleanup()

    try {
        if (global.IO) {
            global.IO.close()
        }
    } catch (e) {}

    if (server && server.listening) {
        server.close((err) => {
            if (err) {
                console.error("[SHUTDOWN] Error closing HTTP server:", err)
                process.exit(1)
            }
            console.log("[SHUTDOWN] HTTP server closed cleanly.")
            process.exit(0)
        })
    } else {
        process.exit(0)
    }
}

process.on("SIGINT", () => gracefulShutdown("SIGINT"))
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"))
process.on("exit", cleanup)

process.on("uncaughtException", (err) => {
    console.error("[CRITICAL] Uncaught exception:", err && err.message ? err.message : err)
    gracefulShutdown("uncaughtException")
})

process.on("unhandledRejection", (reason) => {
    console.warn("[WARN] Unhandled promise rejection:", reason && reason.message ? reason.message : reason)
})

// Start server if executed directly
if (require.main === module) {
    server.listen(PORT, async () => {
        const localURL = `http://localhost:${PORT}`
        console.log(`LOCAL   : ${localURL}`)
        if (global.lanURL) {
            console.log(`NETWORK : ${global.lanURL} (Devices on same Wi-Fi)`)
        }

        if (config.enableTunnel) {
            try {
                console.log(`Starting Cloudflare tunnel (HTTP/2) for ${localURL}...`)
                // protocol http2 is required because QUIC (UDP 7844) is frequently blocked on firewalls
                tunnelInstance = cloudflaredTunnel({
                    "--url": localURL,
                    "--protocol": "http2"
                })

                const tunnelUrlPromise = tunnelInstance.url
                const connectionPromise = (Array.isArray(tunnelInstance.connections) && tunnelInstance.connections[0])
                    ? tunnelInstance.connections[0]
                    : Promise.resolve()

                const publicUrl = await tunnelUrlPromise

                try {
                    await Promise.race([
                        connectionPromise,
                        new Promise((_, reject) => setTimeout(() => reject(new Error("Edge handshake timeout")), 10000))
                    ])
                    console.log(`[Cloudflare] Tunnel connection registered successfully at edge`)
                } catch (connWaitErr) {
                    console.warn(`[Cloudflare] Edge handshake progress note: ${connWaitErr.message || connWaitErr}`)
                }

                global.remoteURL = publicUrl
                console.log(`REMOTE  : ${global.remoteURL}`)

                if (global.IO) {
                    global.IO.emit("remote-url", {
                        remoteURL: global.remoteURL,
                        lanURL: global.lanURL
                    })
                }
            } catch (tunnelErr) {
                console.warn(`[WARN] Cloudflare tunnel could not be started: ${tunnelErr.message || tunnelErr}`)
                console.warn(`[WARN] Application is operating in local network mode at: ${localURL}`)
            }
        } else {
            console.log(`[TUNNEL] Cloudflare tunnel disabled by configuration (ENABLE_TUNNEL=false).`)
        }
    })
}

module.exports = { app, server, io }