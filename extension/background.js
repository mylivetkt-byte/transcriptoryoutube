// background.js - Sincronización Automática en Segundo Plano (Service Worker MV3)

const DEFAULT_SERVER_URL = "https://descargasyoutube.grupocmg.digital";
const DEFAULT_SYNC_TOKEN = "cmg-transcriptor-2026";
const ALARM_NAME = "sync_youtube_cookies_alarm";

// Inicialización de la alarma de sincronización periódica
chrome.runtime.onInstalled.addListener(() => {
    chrome.alarms.create(ALARM_NAME, {
        periodInMinutes: 720 // Cada 12 horas
    });
    console.log("[Transcriptor Sync] Alarma de sincronización configurada cada 12 horas.");
});

// Evento de alarma periódica
chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === ALARM_NAME) {
        const config = await chrome.storage.local.get(["autoSync"]);
        if (config.autoSync !== false) {
            console.log("[Transcriptor Sync] Ejecutando sincronización automática periódica...");
            await performBackgroundSync();
        }
    }
});

// Sincronización oportunista al navegar en YouTube
chrome.webNavigation?.onCompleted?.addListener(async (details) => {
    if (details.url && details.url.includes("youtube.com")) {
        const config = await chrome.storage.local.get(["autoSync", "lastSyncTimestamp"]);
        if (config.autoSync === false) return;

        const now = Date.now();
        const sixHours = 6 * 60 * 60 * 1000;
        // Solo sincronizar si han pasado más de 6 horas desde la última vez
        if (!config.lastSyncTimestamp || (now - config.lastSyncTimestamp) > sixHours) {
            console.log("[Transcriptor Sync] Visita a YouTube detectada. Sincronizando cookies frescas...");
            await performBackgroundSync();
        }
    }
}, { url: [{ hostContains: "youtube.com" }] });

// Función central de sincronización
async function performBackgroundSync() {
    try {
        const config = await chrome.storage.local.get(["serverUrl", "syncToken"]);
        const serverUrl = (config.serverUrl || DEFAULT_SERVER_URL).replace(/\/+$/, "");
        const syncToken = config.syncToken || DEFAULT_SYNC_TOKEN;

        const ytCookies = await chrome.cookies.getAll({ domain: ".youtube.com" });
        const googleCookies = await chrome.cookies.getAll({ domain: ".google.com" });
        const allCookies = [...ytCookies, ...googleCookies];

        if (allCookies.length === 0) {
            console.warn("[Transcriptor Sync] No hay cookies de YouTube activas.");
            return;
        }

        const resp = await fetch(`${serverUrl}/api/sync-cookies`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Sync-Token": syncToken
            },
            body: JSON.stringify({
                cookies_list: allCookies.map(c => ({
                    domain: c.domain,
                    name: c.name,
                    value: c.value,
                    path: c.path,
                    secure: c.secure,
                    expirationDate: c.expirationDate || 2147483647
                }))
            })
        });

        if (resp.ok) {
            const now = Date.now();
            await chrome.storage.local.set({ lastSyncTimestamp: now });
            console.log(`[Transcriptor Sync] Cookies sincronizadas exitosamente en segundo plano (${allCookies.length} cookies).`);
        } else {
            console.error(`[Transcriptor Sync] Error del servidor: HTTP ${resp.status}`);
        }
    } catch (e) {
        console.error("[Transcriptor Sync] Error en sincronización:", e);
    }
}

// Receptor de mensajes del popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "toggle_auto_sync") {
        if (request.enabled) {
            chrome.alarms.create(ALARM_NAME, { periodInMinutes: 720 });
        } else {
            chrome.alarms.clear(ALARM_NAME);
        }
        sendResponse({ success: true });
    }
});
