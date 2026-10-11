// High-Accuracy Real-Time Browser Device Diagnostics Collector
(function (global) {
    let batteryState = {
        level: "Information Unavailable",
        charging: "Information Unavailable"
    };

    let highEntropyData = null;
    let batteryPromise = null;
    let highEntropyPromise = null;

    // 1. Proactive Battery API Listener
    if (typeof navigator !== "undefined" && typeof navigator.getBattery === "function") {
        try {
            batteryPromise = navigator.getBattery().then(battery => {
                function syncBattery() {
                    if (battery && typeof battery.level === "number" && !isNaN(battery.level)) {
                        batteryState.level = `${Math.round(battery.level * 100)}%`;
                    } else {
                        batteryState.level = "Information Unavailable";
                    }
                    if (battery && typeof battery.charging === "boolean") {
                        batteryState.charging = battery.charging ? "Charging" : "Not Charging";
                    } else {
                        batteryState.charging = "Information Unavailable";
                    }
                }
                syncBattery();
                battery.addEventListener("levelchange", syncBattery);
                battery.addEventListener("chargingchange", syncBattery);
                return battery;
            }).catch(() => null);
        } catch (e) {}
    }

    // 2. High-Entropy Client Hints probe (Windows 11 vs 10, exact phone model, architecture, full version)
    if (typeof navigator !== "undefined" && navigator.userAgentData && typeof navigator.userAgentData.getHighEntropyValues === "function") {
        try {
            highEntropyPromise = navigator.userAgentData.getHighEntropyValues([
                "platform",
                "platformVersion",
                "architecture",
                "model",
                "bitness",
                "uaFullVersion",
                "fullVersionList"
            ]).then(hints => {
                highEntropyData = hints;
                return hints;
            }).catch(() => null);
        } catch (e) {}
    }

    function detectDeviceCategory() {
        if (typeof navigator === "undefined") return "Information Unavailable";

        const maxTouch = navigator.maxTouchPoints || 0;
        const w = (typeof window !== "undefined" && window.screen) ? window.screen.width : 0;
        const h = (typeof window !== "undefined" && window.screen) ? window.screen.height : 0;
        const minDim = Math.min(w, h);

        // Check if exact model is exposed via High Entropy hints
        let model = "";
        if (highEntropyData && highEntropyData.model && typeof highEntropyData.model === "string" && highEntropyData.model.trim()) {
            model = highEntropyData.model.trim();
        }

        const rawUA = navigator.userAgent || "";
        // Extract model name from Android UA if not already found
        if (!model && /Android/i.test(rawUA)) {
            const m = rawUA.match(/Android[^;]+;\s*([^;)]+)\s*(?:Build|[;)])/i);
            if (m && m[1] && !/K|wv/i.test(m[1].trim())) {
                model = m[1].trim();
            }
        }

        if (navigator.userAgentData && typeof navigator.userAgentData.mobile === "boolean") {
            if (navigator.userAgentData.mobile) {
                const ua = rawUA.toLowerCase();
                if (ua.includes("tablet") || ua.includes("ipad") || (minDim >= 600 && maxTouch > 1)) {
                    return model ? `Tablet (${model})` : "Tablet";
                }
                return model ? `Mobile (${model})` : "Mobile";
            } else {
                return "Desktop";
            }
        }

        const ua = rawUA.toLowerCase();
        if (!ua) return "Information Unavailable";

        // iPad / iPadOS (often reports Macintosh in UA on iPadOS 13+)
        if (ua.includes("ipad") || (ua.includes("macintosh") && maxTouch > 1)) {
            return "Tablet";
        }
        if (ua.includes("tablet") || (ua.includes("android") && !ua.includes("mobile"))) {
            return model ? `Tablet (${model})` : "Tablet";
        }
        if (/mobi|iphone|ipod|android.*mobile|windows phone|blackberry/i.test(ua)) {
            if (/iphone/i.test(ua)) return "Mobile (iPhone)";
            return model ? `Mobile (${model})` : "Mobile";
        }
        if (/windows|macintosh|mac os x|linux|cros/i.test(ua)) {
            return "Desktop";
        }

        return "Information Unavailable";
    }

    function detectOS() {
        if (typeof navigator === "undefined") return "Information Unavailable";
        const rawUA = navigator.userAgent || "";

        // 1. High-Entropy Hints: accurate Windows 11 vs 10 distinction, macOS / Android versions, and bitness
        if (highEntropyData && highEntropyData.platform) {
            const p = highEntropyData.platform;
            const bitness = highEntropyData.bitness ? ` (${highEntropyData.bitness}-bit)` : "";

            if (/windows/i.test(p)) {
                if (highEntropyData.platformVersion) {
                    const majorVer = parseInt(highEntropyData.platformVersion.split(".")[0], 10);
                    if (majorVer >= 13) return `Windows 11${bitness}`;
                    if (majorVer > 0) return `Windows 10${bitness}`;
                }
                return `Windows 10/11${bitness}`;
            }
            if (/android/i.test(p)) {
                if (highEntropyData.platformVersion) {
                    return `Android ${highEntropyData.platformVersion}`;
                }
                return "Android";
            }
            if (/macos/i.test(p)) {
                if (highEntropyData.platformVersion) {
                    return `macOS ${highEntropyData.platformVersion}`;
                }
                return "macOS";
            }
            if (/linux/i.test(p)) return `Linux${bitness}`;
            if (/chrome\s?os/i.test(p)) return "Chrome OS";
        }

        // 2. Comprehensive User-Agent Inspection fallback
        if (!rawUA) return "Information Unavailable";

        // Detect iPadOS specifically (Macintosh with touch points)
        if (/Macintosh/i.test(rawUA) && (navigator.maxTouchPoints || 0) > 1) {
            return "iPadOS";
        }

        const is64 = /Win64|x64|WOW64|x86_64|amd64/i.test(rawUA) ? " (64-bit)" : "";

        if (/Windows NT 10.0/i.test(rawUA)) return `Windows 10/11${is64}`;
        if (/Windows NT 6.3/i.test(rawUA)) return `Windows 8.1${is64}`;
        if (/Windows NT 6.2/i.test(rawUA)) return `Windows 8${is64}`;
        if (/Windows NT 6.1/i.test(rawUA)) return `Windows 7${is64}`;
        if (/Windows NT 6.0/i.test(rawUA)) return `Windows Vista${is64}`;
        if (/Windows NT 5.1/i.test(rawUA)) return `Windows XP${is64}`;
        if (/Windows/i.test(rawUA)) return `Windows${is64}`;

        if (/Android\s+([0-9.]+)/i.test(rawUA)) {
            const m = rawUA.match(/Android\s+([0-9.]+)/i);
            return m ? `Android ${m[1]}` : "Android";
        }
        if (/iPhone OS\s+([0-9_]+)/i.test(rawUA)) {
            const m = rawUA.match(/iPhone OS\s+([0-9_]+)/i);
            return m ? `iOS ${m[1].replace(/_/g, ".")}` : "iOS";
        }
        if (/iPad.*OS\s+([0-9_]+)/i.test(rawUA)) {
            const m = rawUA.match(/OS\s+([0-9_]+)/i);
            return m ? `iPadOS ${m[1].replace(/_/g, ".")}` : "iPadOS";
        }
        if (/Mac OS X\s+([0-9_]+)/i.test(rawUA)) {
            const m = rawUA.match(/Mac OS X\s+([0-9_]+)/i);
            return m ? `macOS ${m[1].replace(/_/g, ".")}` : "macOS";
        }
        if (/CrOS/i.test(rawUA)) return "Chrome OS";
        if (/Linux/i.test(rawUA)) return `Linux${is64}`;

        return "Information Unavailable";
    }

    function detectBrowser() {
        if (typeof navigator === "undefined") return "Information Unavailable";

        // Check fullVersionList if available from high-entropy client hints
        if (highEntropyData && Array.isArray(highEntropyData.fullVersionList)) {
            const realBrand = highEntropyData.fullVersionList.find(b => 
                !b.brand.includes("Chromium") && 
                !b.brand.includes("Not") && 
                !b.brand.includes("Brand")
            );
            if (realBrand) {
                return `${realBrand.brand} ${realBrand.version}`;
            }
        }

        // Standard userAgentData brands
        if (navigator.userAgentData && Array.isArray(navigator.userAgentData.brands)) {
            const realBrand = navigator.userAgentData.brands.find(b => 
                !b.brand.includes("Chromium") && 
                !b.brand.includes("Not") && 
                !b.brand.includes("Brand")
            );
            if (realBrand) {
                const ver = (highEntropyData && highEntropyData.uaFullVersion) ? highEntropyData.uaFullVersion : realBrand.version;
                return `${realBrand.brand} ${ver}`;
            }
        }

        const rawUA = navigator.userAgent || "";
        if (!rawUA) return "Information Unavailable";

        let match;
        if (navigator.brave && typeof navigator.brave.isBrave === "function") {
            if ((match = rawUA.match(/Chrome\/([0-9.]+)/i))) {
                return `Brave ${match[1]}`;
            }
            return "Brave";
        }
        if ((match = rawUA.match(/Edg(?:e)?\/([0-9.]+)/i))) {
            return `Microsoft Edge ${match[1]}`;
        }
        if ((match = rawUA.match(/OPR\/([0-9.]+)/i)) || (match = rawUA.match(/Opera\/([0-9.]+)/i))) {
            return `Opera ${match[1]}`;
        }
        if ((match = rawUA.match(/SamsungBrowser\/([0-9.]+)/i))) {
            return `Samsung Internet ${match[1]}`;
        }
        if ((match = rawUA.match(/Vivaldi\/([0-9.]+)/i))) {
            return `Vivaldi ${match[1]}`;
        }
        if ((match = rawUA.match(/YaBrowser\/([0-9.]+)/i))) {
            return `Yandex Browser ${match[1]}`;
        }
        if ((match = rawUA.match(/Chrome\/([0-9.]+)/i)) && !rawUA.includes("Chromium")) {
            return `Chrome ${match[1]}`;
        }
        if ((match = rawUA.match(/Firefox\/([0-9.]+)/i))) {
            return `Firefox ${match[1]}`;
        }
        if (/Safari/i.test(rawUA) && (match = rawUA.match(/Version\/([0-9.]+)/i))) {
            return `Safari ${match[1]}`;
        }
        if ((match = rawUA.match(/Chromium\/([0-9.]+)/i))) {
            return `Chromium ${match[1]}`;
        }

        return "Information Unavailable";
    }

    function detectScreen() {
        if (typeof window !== "undefined" && window.screen && typeof window.screen.width === "number" && typeof window.screen.height === "number") {
            if (window.screen.width > 0 && window.screen.height > 0) {
                const dpr = window.devicePixelRatio || 1;
                const roundedDpr = Math.round(dpr * 100) / 100;
                return `${window.screen.width} × ${window.screen.height} (@${roundedDpr}x DPR)`;
            }
        }
        return "Information Unavailable";
    }

    function getNetworkInfo() {
        let connection = "Information Unavailable";
        let networkQuality = "Information Unavailable";
        let downlink = "Information Unavailable";
        let rtt = "Information Unavailable";

        if (typeof navigator !== "undefined") {
            const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
            if (conn) {
                if (conn.type && conn.type !== "unknown" && conn.type !== "none") {
                    connection = String(conn.type);
                }
                if (conn.effectiveType) {
                    networkQuality = String(conn.effectiveType).toUpperCase();
                }
                if (typeof conn.downlink === "number" && !isNaN(conn.downlink)) {
                    downlink = `${conn.downlink} Mbps`;
                }
                if (typeof conn.rtt === "number" && !isNaN(conn.rtt)) {
                    rtt = `${conn.rtt} ms`;
                }
            }
        }

        return { connection, networkQuality, downlink, rtt };
    }

    function getEnvironmentInfo() {
        let timezone = "Information Unavailable";
        let language = "Information Unavailable";

        try {
            if (typeof Intl !== "undefined" && Intl.DateTimeFormat) {
                const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
                if (tz && typeof tz === "string" && tz.trim().length > 0) {
                    timezone = tz.trim();
                }
            }
        } catch (e) {}

        if (typeof navigator !== "undefined") {
            if (navigator.language && typeof navigator.language === "string" && navigator.language.trim()) {
                language = navigator.language.trim();
            } else if (navigator.languages && navigator.languages.length > 0 && navigator.languages[0]) {
                language = String(navigator.languages[0]).trim();
            }
        }

        return { timezone, language };
    }

    // Synchronous collector
    function collectRuntimeDiagnostics(position) {
        const net = getNetworkInfo();
        const env = getEnvironmentInfo();

        let accuracy = "Information Unavailable";
        let timestamp = new Date().toISOString();

        if (position && position.coords) {
            if (typeof position.coords.accuracy === "number" && !isNaN(position.coords.accuracy)) {
                const acc = position.coords.accuracy;
                accuracy = acc < 1 ? `±${acc.toFixed(1)} m` : `±${Math.round(acc)} m`;
            }
            if (position.timestamp) {
                timestamp = new Date(position.timestamp).toISOString();
            }
        }

        return {
            device: detectDeviceCategory(),
            os: detectOS(),
            browser: detectBrowser(),
            screen: detectScreen(),
            connection: net.connection,
            networkQuality: net.networkQuality,
            downlink: net.downlink,
            rtt: net.rtt,
            timezone: env.timezone,
            language: env.language,
            batteryLevel: batteryState.level,
            batteryCharging: batteryState.charging,
            accuracy: accuracy,
            timestamp: timestamp
        };
    }

    // Asynchronous collector: guarantees pending promises settle before returning
    async function collectRuntimeDiagnosticsAsync(position) {
        try {
            const timeoutPromise = new Promise(resolve => setTimeout(resolve, 350));
            await Promise.race([
                Promise.allSettled([batteryPromise, highEntropyPromise]),
                timeoutPromise
            ]);
        } catch (e) {}

        return collectRuntimeDiagnostics(position);
    }

    global.collectRuntimeDiagnostics = collectRuntimeDiagnostics;
    global.collectRuntimeDiagnosticsAsync = collectRuntimeDiagnosticsAsync;
})(typeof window !== "undefined" ? window : this);
