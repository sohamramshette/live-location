const { tunnel: cloudflaredTunnel } = require("cloudflared")
const cookieParser = require("cookie-parser")
const socketIO = require("socket.io")
const config = require("./config")
const express = require("express")
const tarkine = require("tarkine")
const http = require('http')
const os = require('os')
const { execSync } = require('child_process')

const app = express()
const server = http.createServer(app)
const io = new socketIO.Server(server)
const PORT = process.env.PORT || config.port
global.remoteURL = ""
global.lanURL = ""

global.IO = io

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

app.set("view engine", "html")
app.engine("html", tarkine.renderFile)
app.use(cookieParser())
app.use(express.urlencoded({ extended: false, limit: "25mb" }))
app.use(express.static(__dirname + "/public"))
app.use(express.json({ limit: "25mb" }))

app.use("/", require("./router"))

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
    }
}

process.on("SIGINT", () => {
    cleanup()
    process.exit(0)
})

process.on("SIGTERM", () => {
    cleanup()
    process.exit(0)
})

process.on("exit", cleanup)

server.listen(PORT, async () => {
    const localURL = `http://localhost:${PORT}`
    console.log(`LOCAL   : ${localURL}`)
    if (global.lanURL) {
        console.log(`NETWORK : ${global.lanURL} (Devices on same Wi-Fi)`)
    }

    try {
        console.log(`Starting Cloudflare tunnel (HTTP/2) for ${localURL}...`)
        // CRITICAL: --protocol http2 is required because QUIC (UDP 7844) is frequently blocked
        // on local networks / firewalls, causing trycloudflare tunnels to fail DNS registration.
        tunnelInstance = cloudflaredTunnel({
            "--url": localURL,
            "--protocol": "http2"
        })

        const tunnelUrlPromise = tunnelInstance.url
        const connectionPromise = (Array.isArray(tunnelInstance.connections) && tunnelInstance.connections[0])
            ? tunnelInstance.connections[0]
            : Promise.resolve()

        // Wait for public URL
        const publicUrl = await tunnelUrlPromise

        // Wait up to 10s for edge connection to register
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
})