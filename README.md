# Live Location Tracker

> **Live Location Tracker**  
> **by AutoGraph**  
> **Created by Soham**

**Live Location Tracker** is an advanced real-time geospatial location tracking, device diagnostics, and verification capture suite. It provides interactive live GPS tracking with Leaflet maps, Socket.IO WebSocket telemetry, client diagnostics probes, and a hardened private photo verification gallery. Designed for cybersecurity demonstrations, educational workshops, ethical hacking seminars, and enterprise delivery telemetry.

---

## Developer & Credits
- **Brand / Developer:** AutoGraph
- **Author:** Created by Soham

---

## Prerequisites & Supported Environments

- **Node.js**: v18.0.0 or higher (Node.js v20+ LTS or v24 recommended)
- **NPM**: v8.0.0 or higher
- **Operating Systems**: Windows 10/11, macOS, Linux (Ubuntu 20.04+, Debian 11+, RHEL 8+)
- **Network Access**:
  - Inbound HTTP port (default `6589`)
  - Outbound TCP 443 / HTTP/2 for Cloudflare Edge Tunnel (optional, fallback to local LAN mode)
- **SSL / HTTPS**: Mandatory in production for browser Geolocation API and MediaDevices (`getUserMedia`) camera access.

---

## Installation & Setup

1. **Clone the repository**:
   ```bash
   git clone https://github.com/sohamramshette/AutoGraph.git live-location-tracker
   cd live-location-tracker
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Configure Environment Variables**:
   Copy the sample environment file and configure your credentials:
   ```bash
   cp .env.example .env
   ```

---

## Environment Variables Configuration

Configure the application by modifying your `.env` file or injecting environment variables into your deployment environment:

| Variable | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `NODE_ENV` | String | `development` | Environment mode (`development` or `production`). Production strictly enforces strong secrets. |
| `PORT` | Integer | `6589` | Port for the HTTP server to bind to. |
| `ADMIN_USERNAME` | String | `admin` *(dev only)* | Administrator dashboard login username. In production, minimum 3 characters. |
| `ADMIN_PASSWORD` | String | `admin` *(dev only)* | Administrator dashboard login password. In production, must be 8+ characters and not default. |
| `SESSION_SECRET` | String | *(dev fallback)* | 32+ character random secret used for HMAC session signing and per-session CSRF token derivation. |
| `SESSION_TTL_HOURS` | Integer | `12` | Active administrator session lifetime in hours. Expired sessions are automatically destroyed. |
| `TRUST_PROXY` | String/Bool | `false` | Set to `true` or proxy IP range (`loopback`) when behind a reverse proxy (Nginx/Caddy/Cloudflare). |
| `ENABLE_TUNNEL` | Boolean | `true` | Enables or disables the automated Cloudflare quick-tunnel. Set to `false` for self-hosted domain/SSL. |
| `UPLOAD_DIR` | String | `./storage/uploads` | Path to private photo verification directory. Stored strictly outside the public web root. |
| `MAX_STORAGE_MB` | Integer | `500` | Disk quota in megabytes for stored photos. Uploads are safely rejected (HTTP 507) when full. |
| `MAX_UPLOAD_SIZE_MB` | Integer | `5` | Maximum upload size per individual photo in megabytes. |
| `MAX_PHOTOS_PER_BATCH` | Integer | `10` | Maximum number of photos allowed in a single verification upload batch. |
| `RATE_LIMIT_MAX` | Integer | `15` | Maximum upload requests allowed per IP address within the sliding window. |
| `RATE_LIMIT_WINDOW_MS` | Integer | `60000` | Duration of the upload rate limiting sliding window in milliseconds (default: 1 minute). |

> [!IMPORTANT]
> **Production Safety Validation**: When `NODE_ENV=production`, the application refuses to start if `ADMIN_PASSWORD` is left as `"admin"` or if `SESSION_SECRET` is missing or under 32 characters.

---

## Running the Application

### Local Development Mode
```bash
npm run dev
# Or standard start:
npm start
```
- Local URL: `http://localhost:6589`
- Network URL: Displayed in console for testing with mobile devices on the same Wi-Fi.

### Production Startup
Set the production environment variables and launch the server:
```bash
NODE_ENV=production npm start
```

### Production Process Managers (PM2)
To run the server continuously in production with automatic restart and log management:
```bash
npm install -g pm2
pm2 start server.js --name "live-location-tracker" --env production
pm2 save
pm2 startup
```

### Managing Server Ports (Windows)
If port 6589 is already bound by an existing instance:
```bash
npm run kill-port
```

---

## Production Deployment & Reverse Proxy Architecture

In a production environment, place the application behind a reverse proxy (Nginx, Caddy, or Cloudflare) configured for SSL termination and WebSocket pass-through.

### Nginx Reverse Proxy Configuration Example
```nginx
server {
    listen 443 ssl http2;
    server_name tracker.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/tracker.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/tracker.yourdomain.com/privkey.pem;

    # Maximum client request body for photo batches
    client_max_body_size 35M;

    location / {
        proxy_pass http://127.0.0.1:6589;
        proxy_http_version 1.1;

        # WebSocket support for Socket.IO
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        # Forwarded Client Information
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;

        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }
}
```
*When deploying behind Nginx or Cloudflare, ensure `TRUST_PROXY=true` in your `.env`.*

---

## Security Architecture & Hardening

1. **Authentication & Session Management**:
   - Replaced static token checks with unpredictable 32-byte cryptographic session identifiers.
   - Dynamic session rotation on login and complete invalidation upon logout (`/logout`).
   - Session cookies configured with `HttpOnly`, `SameSite=Lax`, and `Secure` (in HTTPS/production).
   - In-memory session store automatically cleans up expired sessions every 10 minutes.

2. **Per-Session CSRF Protection**:
   - Admin photo deletion (`POST /admin/photo/delete`) requires mandatory HMAC-SHA256 CSRF validation derived per-session.

3. **Private Upload Storage Hardening**:
   - Photos stored in private directory `./storage/uploads/` completely separate from `/public`.
   - Magic byte validation enforces authentic JPEG (`FF D8 FF`), PNG (`89 50 4E 47`), or WebP (`RIFF...WEBP`) binary signatures.
   - Cryptographically random filenames (`secure_photo_<timestamp>_<uuid>.<ext>`) prevent path traversal and file collision.
   - Two-phase upload pipeline with automatic disk rollback cleanup if any write fails.
   - Disk space quota safeguards (`MAX_STORAGE_MB`) reject uploads with HTTP 507 when storage thresholds are reached.
   - In-memory rate limiting with periodic garbage collection prevents denial of service and memory leaks.

4. **Security Headers & Content Security Policy (CSP)**:
   - `Content-Security-Policy`: Strictly controls allowed sources for scripts, styles, images, and WebSocket connections.
   - `X-Content-Type-Options: nosniff`: Prevents MIME type sniffing.
   - `X-Frame-Options: SAMEORIGIN`: Prevents UI clickjacking attacks.
   - `Referrer-Policy: strict-origin-when-cross-origin`: Minimizes referrer leakage.
   - `Permissions-Policy`: Restricts camera and geolocation to trusted origins.
   - `X-Powered-By`: Express header removed to minimize framework fingerprinting.

5. **Socket.IO Information Leak Prevention**:
   - Real-time WebSocket events broadcast sanitized counts only (`photo-uploaded`, `photo-deleted`).
   - No filesystem paths, server usernames, private filenames, or image buffers are broadcast over WebSockets.

---

## Health Check & Monitoring

- **Endpoint**: `GET /health`
- **Access**: Unauthenticated, lightweight, suitable for Docker health checks, AWS ALB, Kubernetes liveness probes, and uptime monitors.
- **Example Response**:
  ```json
  {
    "status": "ok",
    "timestamp": "2026-10-25T11:47:10.687Z",
    "uptime": 124,
    "environment": "production"
  }
  ```
- **Information Leak Audit**: The endpoint reveals zero system secrets, passwords, or filesystem paths.

---

## Private Storage Directory, Permissions & Backup

### Filesystem Permissions (Linux/macOS)
The private storage directory must be readable and writable only by the dedicated application service user:
```bash
# Set directory permissions so non-app users cannot read photos
chmod 700 ./storage/uploads
chown -R tracker-user:tracker-group ./storage/
```

### Storage Re-Indexing & Restart Recovery
- The server reconstructs its internal photo catalog from disk automatically upon boot (`syncCatalogWithDisk()`).
- Metadata, file sizes, and timestamps are dynamically verified against the filesystem without requiring external database dependencies.

### Backup Strategy
To back up the private stored photos and metadata:
```bash
# Create timestamped tarball backup of stored photos
tar -czvf "backup-photos-$(date +%Y%m%d_%H%M%S).tar.gz" ./storage/uploads/
```

### Disaster Recovery & Restore
To restore stored photos after server migration:
```bash
# Extract into private storage directory
mkdir -p ./storage/uploads
tar -xzvf backup-photos-<timestamp>.tar.gz -C ./
# Restart server to trigger automatic catalog reconciliation
npm start
```

---

## Automated Test Suite

A comprehensive automated test suite validates all production readiness phases using the built-in Node.js test runner (`node:test` and `node:assert`):

To run all automated tests:
```bash
npm test
```

### Test Coverage Includes:
- **Phase 1**: `.gitignore` exclusions, `.env.example` placeholder integrity, and configuration validator.
- **Phase 2**: Unauthenticated redirection (302) and API rejection (401), credential verification, session creation, session cookie attributes, and session destruction on logout.
- **Phase 3**: Magic byte validation, oversized batch rejection, empty data handling, mandatory per-session CSRF protection, rate limiting (429), and disk quota safeguards (507).
- **Phase 4**: Lightweight `/health` probe verification, security headers, CSP presence, fingerprinting suppression, and 404 fallbacks.
- **Diagnostics**: Coordinate boundaries and GPS sanitization for Weather and Delivery targets.

---

## Known Limitations & Troubleshooting

1. **Camera Access Over Insecure HTTP**:
   - Modern browsers (Chrome, Firefox, Safari, Edge) block `navigator.mediaDevices.getUserMedia` when loaded over plain HTTP on remote IP addresses.
   - **Resolution**: Use `localhost` for local tests, the built-in Cloudflare HTTPS edge tunnel, or configure your own domain with SSL via Nginx/Caddy.

2. **UDP Port 7844 (QUIC) Firewalls**:
   - Some enterprise or mobile Wi-Fi routers block outbound UDP port 7844, causing default Cloudflare tunnels to stall.
   - **Resolution**: The server is explicitly pre-configured to use HTTP/2 (`--protocol http2`) over TCP 443 for maximum compatibility.

3. **Storage Quota Exceeded (HTTP 507)**:
   - If uploads fail with error 507, the total size of stored photos has reached `MAX_STORAGE_MB` (default 500MB).
   - **Resolution**: Access the Admin Gallery at `/admin/gallery` and delete unneeded photos, or increase `MAX_STORAGE_MB` in your `.env`.

4. **Upload Rate Limiting (HTTP 429)**:
   - If more than 15 upload requests occur within a single minute from the same IP address, subsequent requests receive HTTP 429.
   - **Resolution**: Wait 60 seconds for the sliding rate-limit window to reset, or adjust `RATE_LIMIT_MAX` in your `.env`.

---

## License & Credits
- **Brand / Developer:** AutoGraph
- **Author:** Created by Soham
- **License:** ISC