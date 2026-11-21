document.addEventListener("DOMContentLoaded", () => {
    // Referencias a Elementos del DOM
    const channelForm = document.getElementById("channel-form");
    const channelUrlInput = document.getElementById("channel-url");
    const maxResultsSelect = document.getElementById("max-results");
    const timestampsToggle = document.getElementById("timestamps-toggle");
    const btnSearch = document.getElementById("btn-search");

    const statusBar = document.getElementById("status-bar");
    const statusMessage = document.getElementById("status-message");

    const resultsHeader = document.getElementById("results-header");
    const countBadge = document.getElementById("count-badge");
    const filterInput = document.getElementById("filter-input");
    const btnTranscribeAll = document.getElementById("btn-transcribe-all");
    const btnStop = document.getElementById("btn-stop");
    const selectAllCheckbox = document.getElementById("select-all");
    const videoGrid = document.getElementById("video-grid");

    const transcriptModal = document.getElementById("transcript-modal");
    const modalVideoTitle = document.getElementById("modal-video-title");
    const modalVideoLink = document.getElementById("modal-video-link");
    const transcriptText = document.getElementById("transcript-text");
    const transcriptSearch = document.getElementById("transcript-search");
    const btnCopy = document.getElementById("btn-copy");
    const btnDownloadModal = document.getElementById("btn-download-modal");

    // Estado de la aplicación
    let currentVideos = [];
    let currentActiveVideo = null;
    let rawTranscriptText = "";
    let activeAbortController = null;

    // Helper de Estado Accesible con Live Region
    function showStatus(message, isError = false, isLoading = true) {
        statusBar.classList.remove("hidden", "error");
        if (isError) {
            statusBar.classList.add("error");
        }
        const icon = statusBar.querySelector(".status-icon");
        if (isLoading) {
            icon.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i>';
        } else if (isError) {
            icon.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i>';
        } else {
            icon.innerHTML = '<i class="fa-solid fa-circle-check"></i>';
        }
        statusMessage.textContent = message;
    }

    function hideStatus() {
        statusBar.classList.add("hidden");
    }

    // Extracción de videos del canal
    channelForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const url = channelUrlInput.value.trim();
        if (!url) return;

        showStatus("Buscando prédicas en el canal de YouTube...", false, true);
        btnSearch.disabled = true;

        try {
            const resp = await fetch("/api/extract-channel", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    url: url,
                    max_results: parseInt(maxResultsSelect.value, 10)
                }),
                signal: AbortSignal.timeout(45000)
            });

            const data = await resp.json();

            if (!resp.ok) {
                throw new Error(data.error || "Error al consultar el canal.");
            }

            currentVideos = data.videos || [];
            renderVideoGrid(currentVideos);

            if (currentVideos.length === 0) {
                showStatus("No se encontraron prédicas en el enlace proporcionado.", true, false);
                resultsHeader.classList.add("hidden");
            } else {
                showStatus(`Se encontraron ${currentVideos.length} prédicas en el canal.`, false, false);
                resultsHeader.classList.remove("hidden");
                countBadge.textContent = currentVideos.length;
            }

        } catch (err) {
            showStatus(err.message, true, false);
        } finally {
            btnSearch.disabled = false;
        }
    });

    // Renderizado atómico del Grid con DocumentFragment y replaceChildren()
    function renderVideoGrid(videos) {
        const fragment = document.createDocumentFragment();

        videos.forEach(video => {
            const card = document.createElement("article");
            card.className = "video-card selected";
            card.dataset.title = video.title.toLowerCase();

            card.innerHTML = `
                <div class="thumbnail-wrapper">
                    <input type="checkbox" class="card-checkbox" checked data-id="${video.id}" aria-label="Seleccionar ${video.title}">
                    <img src="${video.thumbnail}" alt="${video.title}" loading="lazy" width="480" height="270" onerror="this.src='https://via.placeholder.com/480x270?text=Sin+Imagen'">
                    <span class="duration-badge">${video.duration}</span>
                </div>
                <div class="card-body">
                    <h3 class="video-title">${video.title}</h3>
                    <div class="card-footer">
                        <button type="button" class="btn btn-primary btn-card-transcribe" data-id="${video.id}" data-title="${encodeURIComponent(video.title)}">
                            <i class="fa-solid fa-file-signature"></i> Transcribir
                        </button>
                    </div>
                </div>
            `;

            const chk = card.querySelector(".card-checkbox");
            chk.addEventListener("change", () => {
                card.classList.toggle("selected", chk.checked);
            });

            const btn = card.querySelector(".btn-card-transcribe");
            btn.addEventListener("click", () => {
                transcribeVideo(video.id, video.title, btn);
            });

            fragment.appendChild(card);
        });

        // Reemplazo atómico sin parseo repetido de HTML
        videoGrid.replaceChildren(fragment);
    }

    // Filtrar prédicas en vivo
    filterInput.addEventListener("input", () => {
        const query = filterInput.value.toLowerCase().trim();
        const cards = videoGrid.querySelectorAll(".video-card");
        let visibleCount = 0;

        cards.forEach(card => {
            const title = card.dataset.title || "";
            if (title.includes(query)) {
                card.style.display = "grid";
                visibleCount++;
            } else {
                card.style.display = "none";
            }
        });

        countBadge.textContent = visibleCount;
    });

    // Seleccionar / Deseleccionar todo
    selectAllCheckbox.addEventListener("change", () => {
        const checked = selectAllCheckbox.checked;
        videoGrid.querySelectorAll(".card-checkbox:not(:disabled)").forEach(c => {
            c.checked = checked;
            c.closest(".video-card").classList.toggle("selected", checked);
        });
    });

    // Descarga instantánea en el cliente usando Blob (sin consumir servidor)
    function downloadTextFile(title, videoId, text) {
        try {
            const cleanName = title.replace(/[\\/*?:"<>|]/g, "_").trim();
            const filename = videoId ? `${cleanName} [${videoId}].txt` : `${cleanName}.txt`;
            const fileContent = `Título: ${title}\nURL: https://www.youtube.com/watch?v=${videoId}\n${"=".repeat(50)}\n\n${text}`;
            
            const blob = new Blob([fileContent], { type: "text/plain;charset=utf-8" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = filename;
            a.style.display = "none";
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
        } catch (err) {
            console.error("Error al descargar archivo local:", err);
        }
    }

    // Transcripción de un video individual con AbortSignal
    async function transcribeVideo(videoId, title, triggerBtn = null, signal = null) {
        if (triggerBtn) {
            triggerBtn.disabled = true;
            triggerBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Procesando...';
        }
        showStatus(`⏳ Obteniendo transcripción de: "${title}"... (puede tardar 1-3 min si usa Whisper)`, false, true);

        const whisperHint = setTimeout(() => {
            if (triggerBtn && triggerBtn.disabled) {
                triggerBtn.innerHTML = '<i class="fa-solid fa-microphone fa-pulse"></i> Usando Whisper...';
                showStatus(`🎙️ Transcribiendo con Whisper (IA local): "${title}"... Esto puede tardar varios minutos.`, false, true);
            }
        }, 8000);

        try {
            const resp = await fetch("/api/transcribe", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    video_id: videoId,
                    title: title,
                    include_timestamps: timestampsToggle.checked,
                    languages: ["es", "es-419", "es-ES", "es-MX", "en"]
                }),
                signal: signal || AbortSignal.timeout(300000)
            });

            clearTimeout(whisperHint);
            const data = await resp.json();

            if (!resp.ok) {
                throw new Error(data.error || "No se pudo transcribir la prédica.");
            }

            hideStatus();
            showStatus(`✅ Transcripción lista: "${title}"`, false, false);

            if (triggerBtn) {
                triggerBtn.className = "btn btn-success btn-card-transcribe";
                triggerBtn.innerHTML = '<i class="fa-solid fa-check"></i> Descargado';
                triggerBtn.disabled = false;
            }

            downloadTextFile(title, videoId, data.transcript);
            if (!signal) {
                openTranscriptModal(videoId, title, data.transcript);
            }
            return true;

        } catch (err) {
            clearTimeout(whisperHint);
            if (err.name === "AbortError") {
                showStatus(`Cancelado: "${title}"`, true, false);
            } else {
                showStatus(`❌ Error en "${title}": ${err.message}`, true, false);
            }
            if (triggerBtn) {
                triggerBtn.disabled = false;
                triggerBtn.className = "btn btn-outline btn-card-transcribe";
                triggerBtn.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> Reintentar';
            }
            return false;
        }
    }

    // Botón Detener: AbortController real que interrumpe la conexión de red
    btnStop.addEventListener("click", () => {
        if (activeAbortController) {
            activeAbortController.abort();
            activeAbortController = null;
        }
        btnStop.classList.add("hidden");
    });

    // Transcripción masiva por lotes
    btnTranscribeAll.addEventListener("click", async () => {
        const selectedCards = Array.from(videoGrid.querySelectorAll(".video-card.selected"))
            .filter(c => c.style.display !== "none");

        if (selectedCards.length === 0) {
            showStatus("Selecciona al menos una prédica con el checkbox.", true, false);
            return;
        }

        activeAbortController = new AbortController();
        btnTranscribeAll.disabled = true;
        btnStop.classList.remove("hidden");
        showStatus(`Iniciando transcripción masiva (${selectedCards.length} prédicas)...`, false, true);

        let successCount = 0;
        let failCount = 0;

        for (let i = 0; i < selectedCards.length; i++) {
            if (activeAbortController.signal.aborted) {
                showStatus(`❌ Proceso detenido por el usuario. ${successCount} completadas, ${failCount} fallidas.`, true, false);
                break;
            }

            const card = selectedCards[i];
            const btn = card.querySelector(".btn-card-transcribe");
            if (!btn) continue;

            const vid = btn.dataset.id;
            const title = decodeURIComponent(btn.dataset.title);

            showStatus(`[${i+1}/${selectedCards.length}] Transcribiendo: "${title}"...`, false, true);

            const ok = await transcribeVideo(vid, title, btn, activeAbortController.signal);
            if (ok) {
                successCount++;
            } else {
                failCount++;
            }

            if (i < selectedCards.length - 1 && !activeAbortController.signal.aborted) {
                await new Promise(r => setTimeout(r, 2000));
            }
        }

        btnStop.classList.add("hidden");
        btnTranscribeAll.disabled = false;
        if (!activeAbortController.signal.aborted) {
            showStatus(`Proceso completado: ${successCount} descargadas, ${failCount} sin transcripción.`, false, false);
        }
    });

    // Control del <dialog> Nativo
    function openTranscriptModal(videoId, title, transcript) {
        currentActiveVideo = { id: videoId, title: title };
        rawTranscriptText = transcript;

        modalVideoTitle.textContent = title;
        modalVideoLink.href = `https://www.youtube.com/watch?v=${videoId}`;
        transcriptText.textContent = transcript;
        transcriptSearch.value = "";

        // showModal() nativo: Top layer, inert page, trampa de foco y backdrop
        transcriptModal.showModal();
    }

    // Fallback para light-dismiss en navegadores sin soporte nativo de closedby="any"
    if (!('closedBy' in HTMLDialogElement.prototype)) {
        transcriptModal.addEventListener('click', (event) => {
            if (event.target !== transcriptModal) return;
            const rect = transcriptModal.getBoundingClientRect();
            const isInDialog = (
                rect.top <= event.clientY && event.clientY <= rect.top + rect.height &&
                rect.left <= event.clientX && event.clientX <= rect.left + rect.width
            );
            if (!isInDialog) {
                transcriptModal.close();
            }
        });
    }

    // Búsqueda dentro de la transcripción
    transcriptSearch.addEventListener("input", () => {
        const query = transcriptSearch.value.trim().toLowerCase();
        if (!query) {
            transcriptText.textContent = rawTranscriptText;
            return;
        }

        const lines = rawTranscriptText.split("\n");
        const filteredLines = lines.filter(line => line.toLowerCase().includes(query));

        if (filteredLines.length === 0) {
            transcriptText.textContent = `No se encontraron coincidencias para "${query}".`;
        } else {
            transcriptText.textContent = filteredLines.join("\n");
        }
    });

    // Copiado al Portapapeles con Live Region (Patrón Copy Button de Modern Web Guidance)
    const copyStatus = document.querySelector(".copy-status");
    let copyTimer = null;

    btnCopy.addEventListener("click", async () => {
        if (!rawTranscriptText) return;
        clearTimeout(copyTimer);
        btnCopy.removeAttribute("data-copied");
        btnCopy.removeAttribute("data-failed");

        try {
            await navigator.clipboard.writeText(rawTranscriptText);
            btnCopy.setAttribute("data-copied", "");
            copyStatus.textContent = "¡Copiado!";
        } catch {
            btnCopy.setAttribute("data-failed", "");
            copyStatus.textContent = "Error al copiar";
        }

        copyTimer = setTimeout(() => {
            btnCopy.removeAttribute("data-copied");
            btnCopy.removeAttribute("data-failed");
            copyStatus.textContent = "";
        }, 2200);
    });

    // Descarga desde el modal
    btnDownloadModal.addEventListener("click", () => {
        if (!currentActiveVideo || !rawTranscriptText) return;
        downloadTextFile(currentActiveVideo.title, currentActiveVideo.id, rawTranscriptText);
    });
});
