document.addEventListener("DOMContentLoaded", () => {
    // DOM Elements
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
    const modalOverlay = document.getElementById("modal-overlay");
    const btnCloseModal = document.getElementById("btn-close-modal");
    const modalVideoTitle = document.getElementById("modal-video-title");
    const modalVideoLink = document.getElementById("modal-video-link");
    const transcriptText = document.getElementById("transcript-text");
    const transcriptSearch = document.getElementById("transcript-search");
    const btnCopy = document.getElementById("btn-copy");
    const btnDownloadModal = document.getElementById("btn-download-modal");

    // State
    let currentVideos = [];
    let currentActiveVideo = null;
    let rawTranscriptText = "";
    let cancelled = false;

    // Show status helper
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

    // Extract channel videos
    channelForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const url = channelUrlInput.value.trim();
        if (!url) return;

        showStatus("Buscando prédicas y extractos del canal de YouTube...", false, true);
        btnSearch.disabled = true;

        try {
            const resp = await fetch("/api/extract-channel", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    url: url,
                    max_results: parseInt(maxResultsSelect.value)
                })
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

    // Render Video Grid
    function renderVideoGrid(videos) {
        videoGrid.innerHTML = "";
        videos.forEach(video => {
            const card = document.createElement("div");
            card.className = "video-card selected";
            card.dataset.title = video.title.toLowerCase();

            card.innerHTML = `
                <div class="thumbnail-wrapper">
                    <input type="checkbox" class="card-checkbox" checked data-id="${video.id}">
                    <img src="${video.thumbnail}" alt="${video.title}" loading="lazy" onerror="this.src='https://via.placeholder.com/480x270?text=Sin+Imagen'">
                    <span class="duration-badge">${video.duration}</span>
                </div>
                <div class="card-body">
                    <h3 class="video-title">${video.title}</h3>
                    <div class="card-footer">
                        <button class="btn btn-primary btn-card-transcribe" data-id="${video.id}" data-title="${encodeURIComponent(video.title)}">
                            <i class="fa-solid fa-file-signature"></i> Transcribir
                        </button>
                    </div>
                </div>
            `;
            videoGrid.appendChild(card);

            const chk = card.querySelector(".card-checkbox");
            chk.addEventListener("change", () => {
                card.classList.toggle("selected", chk.checked);
            });
        });
        // Add event listeners to transcribe buttons
        document.querySelectorAll(".btn-card-transcribe").forEach(btn => {
            btn.addEventListener("click", (e) => {
                const vid = btn.dataset.id;
                const title = decodeURIComponent(btn.dataset.title);
                transcribeVideo(vid, title, btn);
            });
        });
    }

    // Filter videos by title
    filterInput.addEventListener("input", () => {
        const query = filterInput.value.toLowerCase().trim();
        const cards = document.querySelectorAll(".video-card");
        let visibleCount = 0;

        cards.forEach(card => {
            const title = card.dataset.title || "";
            if (title.includes(query)) {
                card.style.display = "flex";
                visibleCount++;
            } else {
                card.style.display = "none";
            }
        });

        countBadge.textContent = visibleCount;
    });

    // Select all / deselect all
    selectAllCheckbox.addEventListener("change", () => {
        const checked = selectAllCheckbox.checked;
        document.querySelectorAll(".card-checkbox:not(:disabled)").forEach(c => {
            c.checked = checked;
            c.closest(".video-card").classList.toggle("selected", checked);
        });
    });

    // Stop button
    btnStop.addEventListener("click", () => {
        cancelled = true;
        btnStop.classList.add("hidden");
    });

    async function triggerDownload(videoId, title, text) {
        try {
            const resp = await fetch("/api/download-txt", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ title, video_id: videoId, text })
            });
            const blob = await resp.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.style.display = "none";
            a.href = url;
            a.download = `${title}.txt`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
        } catch (err) {
            console.error("Error al descargar:", err);
        }
    }

    // Transcribe single video — auto-download to browser
    async function transcribeVideo(videoId, title, triggerBtn = null) {
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
                })
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

            await triggerDownload(videoId, title, data.transcript);
            openTranscriptModal(videoId, title, data.transcript);

        } catch (err) {
            clearTimeout(whisperHint);
            showStatus(`❌ Error en "${title}": ${err.message}`, true, false);
            if (triggerBtn) {
                triggerBtn.disabled = false;
                triggerBtn.innerHTML = '<i class="fa-solid fa-file-signature"></i> Transcribir Prédica';
            }
        }
    }

    // Transcribir todas las seleccionadas
    btnTranscribeAll.addEventListener("click", async () => {
        const selectedCards = Array.from(document.querySelectorAll(".video-card.selected"))
            .filter(c => c.style.display !== "none");

        if (selectedCards.length === 0) {
            showStatus("Selecciona al menos una prédica con el checkbox.", true, false);
            return;
        }

        cancelled = false;
        btnTranscribeAll.disabled = true;
        btnStop.classList.remove("hidden");
        showStatus(`Iniciando transcripción masiva (${selectedCards.length} prédicas)...`, false, true);

        let successCount = 0;
        let failCount = 0;

        for (let i = 0; i < selectedCards.length; i++) {
            if (cancelled) {
                showStatus(`❌ Proceso detenido por el usuario. ${successCount} completadas, ${failCount} fallidas.`, true, false);
                break;
            }

            const card = selectedCards[i];
            const btn = card.querySelector(".btn-card-transcribe");
            if (!btn) continue;

            const vid = btn.dataset.id;
            const title = decodeURIComponent(btn.dataset.title);

            showStatus(`[${i+1}/${selectedCards.length}] Transcribiendo: "${title}"...`, false, true);
            btn.disabled = true;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Transcribiendo...';

            try {
                const resp = await fetch("/api/transcribe", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        video_id: vid,
                        title: title,
                        include_timestamps: timestampsToggle.checked,
                        languages: ["es", "es-419", "es-ES", "es-MX", "en"]
                    })
                });

                const data = await resp.json();

                if (!resp.ok) {
                    throw new Error(data.error || "No disponible");
                }

                successCount++;
                btn.className = "btn btn-success btn-card-transcribe";
                btn.innerHTML = '<i class="fa-solid fa-check"></i> Descargado';
                btn.disabled = false;

                await triggerDownload(vid, title, data.transcript);

            } catch (err) {
                failCount++;
                btn.className = "btn btn-outline btn-card-transcribe";
                btn.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> Sin transcripción';
                btn.disabled = false;
            }

            if (i < selectedCards.length - 1 && !cancelled) {
                await new Promise(r => setTimeout(r, 3000));
            }
        }

        btnStop.classList.add("hidden");
        btnTranscribeAll.disabled = false;
        if (!cancelled) {
            showStatus(`Proceso completado: ${successCount} descargadas, ${failCount} sin transcripción.`, false, false);
        }
    });


    // Open Modal
    function openTranscriptModal(videoId, title, transcript) {
        currentActiveVideo = { id: videoId, title: title };
        rawTranscriptText = transcript;

        modalVideoTitle.textContent = title;
        modalVideoLink.href = `https://www.youtube.com/watch?v=${videoId}`;
        transcriptText.textContent = transcript;
        transcriptSearch.value = "";

        transcriptModal.classList.remove("hidden");
    }

    // Close Modal
    function closeModal() {
        transcriptModal.classList.add("hidden");
    }

    btnCloseModal.addEventListener("click", closeModal);
    modalOverlay.addEventListener("click", closeModal);

    // Search within transcript
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

    // Copy to clipboard
    btnCopy.addEventListener("click", async () => {
        if (!rawTranscriptText) return;
        try {
            await navigator.clipboard.writeText(rawTranscriptText);
            const origHTML = btnCopy.innerHTML;
            btnCopy.innerHTML = '<i class="fa-solid fa-check"></i> <span>¡Copiado!</span>';
            setTimeout(() => {
                btnCopy.innerHTML = origHTML;
            }, 2000);
        } catch (err) {
            alert("No se pudo copiar automáticamente. Puedes seleccionar el texto manualmente.");
        }
    });

    // Download TXT
    btnDownloadModal.addEventListener("click", async () => {
        if (!currentActiveVideo || !rawTranscriptText) return;

        try {
            const resp = await fetch("/api/download-txt", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    title: currentActiveVideo.title,
                    video_id: currentActiveVideo.id,
                    text: rawTranscriptText
                })
            });

            const blob = await resp.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.style.display = "none";
            a.href = url;
            a.download = `${currentActiveVideo.title}.txt`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
        } catch (err) {
            alert("Error al descargar el archivo .txt");
        }
    });
});
