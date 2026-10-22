import os
import re
import json
import urllib.request
import urllib.error
from datetime import timedelta
from flask import Flask, render_template, request, jsonify, Response, send_file
from flask_cors import CORS
from playwright.sync_api import sync_playwright
import yt_dlp

app = Flask(__name__)
CORS(app)

def sanitize_filename(name):
    """Sanitize string for file name creation."""
    sanitized = re.sub(r'[\\/*?:"<>|]', "_", name)
    return sanitized.strip(" .")

def format_timestamp(seconds):
    """Format seconds into HH:MM:SS or MM:SS string."""
    try:
        total_seconds = int(float(seconds))
        hours = total_seconds // 3600
        minutes = (total_seconds % 3600) // 60
        secs = total_seconds % 60
        if hours > 0:
            return f"{hours:02d}:{minutes:02d}:{secs:02d}"
        return f"{minutes:02d}:{secs:02d}"
    except Exception:
        return "00:00"

def get_channel_videos(channel_url, max_results=0):
    """Extract list of videos from YouTube channel using yt-dlp."""
    channel_url = channel_url.strip()
    if not channel_url.startswith("http"):
        channel_url = "https://" + channel_url

    if not channel_url.endswith("/videos") and not channel_url.endswith("/streams") and "/watch" not in channel_url:
        channel_url = channel_url.rstrip("/") + "/videos"

    ydl_opts = {
        'extract_flat': True,
        'skip_download': True,
        'quiet': True,
        'no_warnings': True,
        'ignoreerrors': True,
        'http_headers': {
            'Accept-Language': 'es-ES,es;q=0.9,es-419;q=0.8'
        }
    }

    videos = []
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        try:
            info = ydl.extract_info(channel_url, download=False)
            if not info:
                return []

            entries = info.get('entries', [])
            if not entries and 'id' in info:
                entries = [info]

            for entry in entries:
                if not entry:
                    continue
                v_id = entry.get('id')
                v_title = entry.get('title')
                if not v_id or not v_title:
                    continue

                duration = entry.get('duration')
                duration_str = format_timestamp(duration) if duration else "N/A"

                thumbnail = f"https://i.ytimg.com/vi/{v_id}/hqdefault.jpg"

                videos.append({
                    'id': v_id,
                    'title': v_title,
                    'url': f"https://www.youtube.com/watch?v={v_id}",
                    'duration': duration_str,
                    'thumbnail': thumbnail
                })

                if max_results and max_results > 0 and len(videos) >= max_results:
                    break
        except Exception as e:
            print(f"[Canal] Error extrayendo videos: {e}")

    return videos


_whisper_model = None
WHISPER_MODEL_SIZE = "base"

def get_whisper_model():
    global _whisper_model
    if _whisper_model is None:
        try:
            import whisper
            print(f"[Whisper] Cargando modelo '{WHISPER_MODEL_SIZE}'...")
            _whisper_model = whisper.load_model(WHISPER_MODEL_SIZE)
            print("[Whisper] Modelo listo.")
        except ImportError:
            print("[Whisper] ERROR: openai-whisper no está instalado. Ejecuta: pip install openai-whisper")
        except Exception as e:
            print(f"[Whisper] Error cargando modelo: {e}")
    return _whisper_model


def transcribe_with_whisper(video_id, include_timestamps=False, language="es"):
    """Download audio via yt-dlp and transcribe locally with Whisper."""
    import tempfile, time, os, yt_dlp

    model = get_whisper_model()
    if model is None:
        print("[Whisper] No hay modelo disponible para transcribir.")
        return None

    tmpdir = tempfile.mkdtemp()
    audio_template = os.path.join(tmpdir, f"{video_id}.%(ext)s")

    ydl_opts = {
        'format': 'bestaudio/best',
        'outtmpl': audio_template,
        'quiet': True,
        'no_warnings': True,
        'postprocessors': [{'key': 'FFmpegExtractAudio', 'preferredcodec': 'mp3', 'preferredquality': '128'}],
        'extractor_args': {'youtube': {'player_client': ['android', 'mweb']}},
        'http_headers': {
            'User-Agent': 'Mozilla/5.0 (Linux; Android 12; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36',
            'Accept-Language': 'es-ES,es;q=0.9'
        }
    }

    downloaded_path = None
    try:
        print(f"[Whisper] Descargando audio de {video_id}...")
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([f"https://www.youtube.com/watch?v={video_id}"])

        mp3_path = os.path.join(tmpdir, f"{video_id}.mp3")
        if os.path.exists(mp3_path):
            downloaded_path = mp3_path
        else:
            audio_exts = ('.mp3', '.wav', '.m4a', '.ogg', '.webm', '.aac', '.m4v', '.flac')
            files = os.listdir(tmpdir)
            print(f"[Whisper DEBUG] Archivos en temp: {files}")
            for fname in files:
                if fname.startswith(video_id) and fname.lower().endswith(audio_exts):
                    downloaded_path = os.path.join(tmpdir, fname)
                    break
            if not downloaded_path:
                print(f"[Whisper] No hay audio válido. Archivos: {files}")
                return None

        if not downloaded_path:
            print(f"[Whisper] ERROR: No se encontró archivo de audio. Verifica que FFmpeg esté instalado.")
            return None

        print(f"[Whisper] Transcribiendo {video_id} con modelo base y idioma {language}...")
        result = model.transcribe(downloaded_path, language=language, fp16=False)

        if include_timestamps:
            lines = []
            for seg in result.get('segments', []):
                text = seg.get('text', '').strip()
                if text:
                    lines.append(f"[{format_timestamp(seg['start'])}] {text}")
            return "\n".join(lines) if lines else None
        else:
            text = result.get('text', '').strip()
            return text if text else None

    except Exception as e:
        print(f"[Whisper] Error transcribiendo {video_id}: {e}")
        return None
    finally:
        if downloaded_path and os.path.exists(downloaded_path):
            try:
                os.remove(downloaded_path)
            except Exception:
                pass
        try:
            os.rmdir(tmpdir)
        except Exception:
            pass


def fetch_transcript_via_timedtext(video_id, include_timestamps=False):
    """
    Usa Playwright para abrir YouTube en Chromium con --no-sandbox e interceptar o extraer los subtítulos directos.
    """
    import json
    print(f"[Timedtext] Intentando capturar subtítulos con Playwright para {video_id}...")
    timedtext_url = None

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(
                headless=True,
                args=[
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-gpu',
                    '--no-first-run',
                    '--no-zygote'
                ]
            )
            context = browser.new_context(
                user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
            )
            # Cookie para aceptar automáticamente el diálogo de consentimiento de Google/YouTube
            try:
                context.add_cookies([
                    {"name": "SOCS", "value": "CAESEwgDEgk2MTQ5MjAwNzQaAmVuIAEaBgiA_LyaBg", "domain": ".youtube.com", "path": "/"}
                ])
            except Exception:
                pass

            def handle_request(request):
                nonlocal timedtext_url
                if "/api/timedtext?" in request.url and timedtext_url is None:
                    timedtext_url = request.url
                    print(f"[Timedtext] URL interceptada: {timedtext_url[:80]}...")

            page = context.new_page()
            page.on("request", handle_request)

            page.goto(f"https://www.youtube.com/watch?v={video_id}", wait_until="domcontentloaded", timeout=25000)

            for _ in range(20):
                if timedtext_url:
                    break
                page.wait_for_timeout(500)

            json3_data = None

            # Si no capturó la request por evento, extraer del objeto ytInitialPlayerResponse
            if not timedtext_url:
                captions_data = page.evaluate('''() => {
                    try {
                        const p = window.ytInitialPlayerResponse;
                        if (p && p.captions && p.captions.playerCaptionsTracklistRenderer) {
                            return p.captions.playerCaptionsTracklistRenderer.captionTracks || null;
                        }
                    } catch(e) {}
                    return null;
                }''')
                if captions_data:
                    track = next((t for t in captions_data if t.get('languageCode','').startswith('es')), None)
                    if not track:
                        track = next((t for t in captions_data if t.get('languageCode','').startswith('en')), None)
                    if not track and captions_data:
                        track = captions_data[0]
                    if track:
                        timedtext_url = track['baseUrl'] + "&fmt=json3"

            # Intentar obtener el JSON directamente en el contexto del navegador para mantener sesión y cookies
            if timedtext_url:
                fetch_url = timedtext_url if 'fmt=json3' in timedtext_url else (timedtext_url + '&fmt=json3')
                try:
                    json3_data = page.evaluate('''async (url) => {
                        try {
                            const res = await fetch(url);
                            return await res.json();
                        } catch(e) {
                            return null;
                        }
                    }''', fetch_url)
                except Exception as eval_err:
                    print(f"[Timedtext] Error fetch interno en navegador: {eval_err}")

            try:
                browser.close()
            except Exception:
                pass

            if not json3_data and timedtext_url:
                req = urllib.request.Request(timedtext_url, headers={
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36'
                })
                with urllib.request.urlopen(req, timeout=15) as resp:
                    raw = resp.read().decode('utf-8')
                    json3_data = json.loads(raw)

            if not json3_data or 'events' not in json3_data:
                print(f"[Timedtext] No se pudieron extraer eventos de subtítulos para {video_id}")
                return None

            lines = []
            for event in json3_data.get('events', []):
                if 'segs' in event:
                    seg_text = ''.join([s.get('utf8', '') for s in event['segs']]).strip()
                    if seg_text and seg_text not in ('\n', '\\n'):
                        t_sec = event.get('tStartMs', 0) / 1000.0
                        lines.append((t_sec, seg_text.replace('\n', ' ')))

            if not lines:
                print(f"[Timedtext] Sin líneas de texto para {video_id}")
                return None

            result = []
            for t_sec, text in lines:
                if include_timestamps:
                    result.append(f"[{format_timestamp(t_sec)}] {text}")
                else:
                    result.append(text)
            print(f"[Timedtext] ¡Éxito vía Playwright!: {len(result)} líneas para {video_id}")
            return "\n".join(result)

    except Exception as e:
        print(f"[Timedtext] Error en Playwright: {e}")
        return None


def fetch_transcript(video_id, languages=('es', 'es-419', 'es-ES', 'es-MX', 'en'), include_timestamps=False, use_whisper=True):
    """
    Fetch transcript combinando 4 métodos en cascada:
      1. Playwright con Chromium (--no-sandbox)
      2. youtube-transcript-api (directo y listado)
      3. yt-dlp con clientes móviles (ios, android, mweb)
      4. Whisper local (speech-to-text de respaldo)
    """
    import time

    def parse_snippets(items, include_timestamps):
        lines = []
        for item in items:
            text = item.get('text') if isinstance(item, dict) else getattr(item, 'text', '')
            start = item.get('start', 0) if isinstance(item, dict) else getattr(item, 'start', 0)
            text = str(text).replace('\n', ' ').strip()
            if not text:
                continue
            if include_timestamps:
                lines.append(f"[{format_timestamp(start)}] {text}")
            else:
                lines.append(text)
        return "\n".join(lines) if lines else None

    # Método 1: Playwright (Chromium sin sandbox)
    pw_result = fetch_transcript_via_timedtext(video_id, include_timestamps=include_timestamps)
    if pw_result:
        return pw_result

    # Método 2: youtube-transcript-api
    try:
        from youtube_transcript_api import YouTubeTranscriptApi
        ytt = YouTubeTranscriptApi()
        try:
            result = ytt.fetch(video_id, languages=list(languages))
            text = parse_snippets(list(result), include_timestamps)
            if text:
                print(f"[Subtítulos] OK via youtube-transcript-api (fetch) para {video_id}")
                return text
        except Exception:
            tl = ytt.list(video_id)
            for lang in list(languages) + ['es', 'en']:
                try:
                    transcript = tl.find_transcript([lang])
                    text = parse_snippets(list(transcript.fetch()), include_timestamps)
                    if text:
                        print(f"[Subtítulos] OK via youtube-transcript-api (manual) para {video_id}")
                        return text
                except Exception:
                    pass
                try:
                    transcript = tl.find_generated_transcript([lang])
                    text = parse_snippets(list(transcript.fetch()), include_timestamps)
                    if text:
                        print(f"[Subtítulos] OK via youtube-transcript-api (generado) para {video_id}")
                        return text
                except Exception:
                    pass
    except Exception as e:
        print(f"[Subtítulos] youtube-transcript-api falló para {video_id}: {str(e)[:100]}")

    # Método 3: yt-dlp con extractor variado
    try:
        ydl_opts = {
            'skip_download': True,
            'writesubtitles': True,
            'writeautomaticsub': True,
            'subtitleslangs': list(languages) + ['es', 'en'],
            'quiet': True,
            'no_warnings': True,
            'extractor_args': {'youtube': {'player_client': ['ios', 'android', 'mweb']}},
            'http_headers': {
                'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
                'Accept-Language': 'es-ES,es;q=0.9,es-419;q=0.8'
            }
        }
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(f"https://www.youtube.com/watch?v={video_id}", download=False)
            subs = info.get('subtitles') or info.get('automatic_captions') or {}

            lang_key = None
            for l in list(languages) + ['es']:
                if l in subs:
                    lang_key = l
                    break
            if not lang_key:
                es_keys = [k for k in subs if k.startswith('es')]
                lang_key = es_keys[0] if es_keys else (list(subs.keys())[0] if subs else None)

            if lang_key:
                formats = subs[lang_key]
                json3_fmt = next((f for f in formats if f.get('ext') == 'json3'), None) or (formats[0] if formats else None)
                if json3_fmt:
                    req = urllib.request.Request(
                        json3_fmt['url'],
                        headers={
                            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15',
                            'Accept-Language': 'es-ES,es;q=0.9'
                        }
                    )
                    with urllib.request.urlopen(req, timeout=15) as resp:
                        data = json.loads(resp.read().decode('utf-8'))
                        lines = []
                        for event in data.get('events', []):
                            if 'segs' in event:
                                seg_text = ''.join([s.get('utf8', '') for s in event['segs']]).strip()
                                if seg_text and seg_text not in ('\n', '\\n'):
                                    t_sec = event.get('tStartMs', 0) / 1000.0
                                    if include_timestamps:
                                        lines.append(f"[{format_timestamp(t_sec)}] {seg_text}")
                                    else:
                                        lines.append(seg_text)
                        if lines:
                            print(f"[Subtítulos] OK via yt-dlp para {video_id}")
                            return "\n".join(lines)
    except Exception as e:
        print(f"[yt-dlp] Extracción de subtítulos falló para {video_id}: {str(e)[:100]}")

    # Método 4: Whisper como respaldo
    if use_whisper:
        print(f"[Whisper] Intentando transcripción por audio local para {video_id}...")
        text = transcribe_with_whisper(video_id, include_timestamps=include_timestamps)
        if text:
            print(f"[Whisper] OK para {video_id}")
            return text
        print(f"[Whisper] Sin resultado para {video_id}")

    return None


@app.route("/")
def index():
    return render_template("index.html")

@app.route("/api/extract-channel", methods=["POST"])
def api_extract_channel():
    data = request.get_json() or {}
    channel_url = data.get("url", "").strip()
    max_results = int(data.get("max_results", 0))
    
    if not channel_url:
        return jsonify({"error": "Por favor ingrese una URL válida del canal."}), 400

    videos = get_channel_videos(channel_url, max_results=max_results)
    return jsonify({
        "channel_url": channel_url,
        "count": len(videos),
        "videos": videos
    })

@app.route("/api/transcribe", methods=["POST"])
def api_transcribe():
    data = request.get_json() or {}
    video_id = data.get("video_id")
    title = data.get("title", video_id)
    include_timestamps = bool(data.get("include_timestamps", False))
    languages = data.get("languages", ["es", "es-419", "es-ES", "es-MX", "en"])

    if not video_id:
        return jsonify({"error": "ID de video requerido."}), 400

    text = fetch_transcript(video_id, languages=languages, include_timestamps=include_timestamps)

    if not text:
        return jsonify({"error": "No se pudo obtener la transcripción. El video no tiene subtítulos ni se pudo transcribir con Whisper."}), 404

    return jsonify({
        "video_id": video_id,
        "title": title,
        "transcript": text
    })

@app.route("/api/download-txt", methods=["POST"])
def api_download_txt():
    data = request.get_json() or {}
    title = data.get("title", "transcripcion")
    video_id = data.get("video_id", "")
    text = data.get("text", "")

    clean_name = sanitize_filename(title)
    filename = f"{clean_name} [{video_id}].txt" if video_id else f"{clean_name}.txt"

    content = f"Título: {title}\nURL: https://www.youtube.com/watch?v={video_id}\n" + ("=" * 50) + "\n\n" + text

    import urllib.parse
    safe_filename = urllib.parse.quote(filename)

    return Response(
        content,
        mimetype="text/plain; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{safe_filename}"}
    )


@app.route("/api/save-batch-transcript", methods=["POST"])
def api_save_batch_transcript():
    data = request.get_json() or {}
    video_id = data.get("video_id")
    title = data.get("title", video_id)
    output_folder = data.get("output_folder", "").strip()
    if not output_folder:
        output_folder = os.environ.get("TRANSCRIPTOR_OUTPUT", "predicaciones")
    elif not os.path.isabs(output_folder):
        base_dir = os.path.dirname(os.path.abspath(__file__))
        output_folder = os.path.join(base_dir, output_folder)

    include_timestamps = bool(data.get("include_timestamps", False))
    languages = data.get("languages", ["es", "es-419", "es-ES", "es-MX", "en"])

    if not video_id:
        return jsonify({"error": "ID de video requerido."}), 400

    clean_name = sanitize_filename(title)
    filename = f"{clean_name} [{video_id}].txt"
    os.makedirs(output_folder, exist_ok=True)
    filepath = os.path.join(output_folder, filename)

    if os.path.exists(filepath):
        return jsonify({
            "success": True,
            "already_existed": True,
            "filepath": os.path.abspath(filepath),
            "filename": filename,
            "title": title
        })

    text = fetch_transcript(video_id, languages=languages, include_timestamps=include_timestamps)

    if not text:
        return jsonify({"error": "No se encontró transcripción disponible para esta prédica."}), 404

    content = f"Título: {title}\nURL: https://www.youtube.com/watch?v={video_id}\n" + ("=" * 60) + "\n\n" + text

    with open(filepath, "w", encoding="utf-8") as f:
        f.write(content)

    return jsonify({
        "success": True,
        "already_existed": False,
        "filepath": os.path.abspath(filepath),
        "filename": filename,
        "title": title
    })

if __name__ == "__main__":
    print("Iniciando servidor web Transcriptor en http://localhost:5000")
    app.run(host="0.0.0.0", port=5000, debug=False, use_reloader=False)