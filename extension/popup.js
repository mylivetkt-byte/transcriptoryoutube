// popup.js - Transcriptor Cookie Sync

document.addEventListener("DOMContentLoaded", async () => {
    const serverUrlInput = document.getElementById("server-url");
    const syncTokenInput = document.getElementById("sync-token");
    const btnSync = document.getElementById("btn-sync");
    const autoSyncToggle = document.getElementById("auto-sync-toggle");
    const statusBox = document.getElementById("status-box");
    const lastSyncTime = document.getElementById("last-sync-time");

    // Cargar configuración guardada
    const config = await chrome.storage.local.get([
        "serverUrl",
        "syncToken",
        "autoSync",
        "lastSyncTimestamp"
    ]);

    if (config.serverUrl) serverUrlInput.value = config.serverUrl;
    if (config.syncToken) syncTokenInput.value = config.syncToken;
    if (typeof config.autoSync === "boolean") autoSyncToggle.checked = config.autoSync;
    if (config.lastSyncTimestamp) {
        const d = new Date(config.lastSyncTimestamp);
        lastSyncTime.textContent = `Última sinc: ${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
    }

    // Guardar cambios en inputs
    serverUrlInput.addEventListener("change", () => {
        chrome.storage.local.set({ serverUrl: serverUrlInput.value.trim() });
    });
    syncTokenInput.addEventListener("change", () => {
        chrome.storage.local.set({ syncToken: syncTokenInput.value.trim() });
    });
    autoSyncToggle.addEventListener("change", () => {
        chrome.storage.local.set({ autoSync: autoSyncToggle.checked });
        chrome.runtime.sendMessage({ action: "toggle_auto_sync", enabled: autoSyncToggle.checked });
    });

    // Función para mostrar status
    function showStatus(msg, isSuccess = true) {
        statusBox.className = isSuccess ? "status-box success" : "status-box error";
        statusBox.textContent = msg;
    }

    // Botón de sincronización manual
    btnSync.addEventListener("click", async () => {
        btnSync.disabled = true;
        btnSync.innerHTML = "<span>⏳ Obteniendo cookies de YouTube...</span>";
        statusBox.className = "status-box";
        statusBox.style.display = "none";

        try {
            const serverUrl = serverUrlInput.value.trim().replace(/\/+$/, "");
            const syncToken = syncTokenInput.value.trim();

            // 1. Obtener todas las cookies de YouTube usando la API nativa de Chrome
            const ytCookies = await chrome.cookies.getAll({ domain: ".youtube.com" });
            const googleCookies = await chrome.cookies.getAll({ domain: ".google.com" });

            // Combinar cookies relevantes
            const allCookies = [...ytCookies, ...googleCookies];

            if (allCookies.length === 0) {
                throw new Error("No se encontraron cookies de YouTube en tu Chrome. Abre www.youtube.com e inicia sesión.");
            }

            btnSync.innerHTML = `<span>⏳ Enviando ${allCookies.length} cookies al servidor...</span>`;

            // 2. Enviar cookies al servidor
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

            const data = await resp.json();

            if (!resp.ok) {
                throw new Error(data.error || `HTTP ${resp.status}: Error en el servidor.`);
            }

            const now = Date.now();
            await chrome.storage.local.set({ lastSyncTimestamp: now });
            const d = new Date(now);
            lastSyncTime.textContent = `Última sinc: ${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;

            showStatus(`✅ ¡Éxito! Se sincronizaron ${allCookies.length} cookies con tu servidor en producción.`, true);

        } catch (err) {
            showStatus(`❌ ${err.message}`, false);
        } finally {
            btnSync.disabled = false;
            btnSync.innerHTML = "<span>🔄 Sincronizar Cookies Ahora</span>";
        }
    });
});
