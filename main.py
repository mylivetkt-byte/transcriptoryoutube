import argparse
import os
import re
import sys
from datetime import timedelta
import yt_dlp
from youtube_transcript_api import YouTubeTranscriptApi, TranscriptsDisabled, NoTranscriptFound, CouldNotRetrieveTranscript

def sanitize_filename(name):
    """Sanitize string for file name creation."""
    # Replace invalid filename characters with underscores
    sanitized = re.sub(r'[\\/*?:"<>|]', "_", name)
    # Remove leading/trailing whitespaces and dots
    return sanitized.strip(" .")

def format_timestamp(seconds):
    """Format seconds into HH:MM:SS string."""
    td = timedelta(seconds=int(seconds))
    total_seconds = int(td.total_seconds())
    hours = total_seconds // 3600
    minutes = (total_seconds % 3600) // 60
    secs = total_seconds % 60
    if hours > 0:
        return f"{hours:02d}:{minutes:02d}:{secs:02d}"
    return f"{minutes:02d}:{secs:02d}"

def get_channel_videos(channel_url, max_videos=None):
    """Extract list of video info (id, title) from YouTube channel/playlist using yt-dlp."""
    ydl_opts = {
        'extract_flat': 'in_playlist',
        'skip_download': True,
        'quiet': True,
        'no_warnings': True,
        'ignoreerrors': True,
    }

    videos = []
    print(f"Obteniendo la lista de videos desde: {channel_url}...")
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        try:
            info = ydl.extract_info(channel_url, download=False)
            if 'entries' in info:
                entries = list(info['entries'])
                for entry in entries:
                    if not entry:
                        continue
                    v_id = entry.get('id')
                    v_title = entry.get('title', v_id)
                    if v_id:
                        videos.append({'id': v_id, 'title': v_title})
                    if max_videos and len(videos) >= max_videos:
                        break
            elif 'id' in info:
                videos.append({'id': info['id'], 'title': info.get('title', info['id'])})
        except Exception as e:
            print(f"Error al extraer la lista del canal: {e}")
            
    print(f"Se encontraron {len(videos)} videos.")
    return videos

def download_transcript(video_id, languages=('es', 'en'), include_timestamps=False):
    """Fetch transcript for a given video ID."""
    try:
        # Try retrieving transcript with preferred languages
        transcript_list = YouTubeTranscriptApi.get_transcript(video_id, languages=languages)
        
        lines = []
        for item in transcript_list:
            text = item['text'].replace('\n', ' ')
            if include_timestamps:
                start_time = format_timestamp(item['start'])
                lines.append(f"[{start_time}] {text}")
            else:
                lines.append(text)
                
        return "\n".join(lines)
    except (TranscriptsDisabled, NoTranscriptFound):
        return None
    except Exception as e:
        print(f"  [Error video {video_id}]: {e}")
        return None

def process_channel(channel_url, output_dir="transcripciones", languages=('es', 'en'), include_timestamps=False, max_videos=None):
    """Main workflow to download transcripts for channel videos."""
    os.makedirs(output_dir, exist_ok=True)
    videos = get_channel_videos(channel_url, max_videos=max_videos)
    
    if not videos:
        print("No se encontraron videos para procesar.")
        return

    success_count = 0
    skipped_count = 0

    for idx, video in enumerate(videos, start=1):
        v_id = video['id']
        v_title = video['title']
        clean_title = sanitize_filename(v_title)
        filename = f"{clean_title} [{v_id}].txt"
        filepath = os.path.join(output_dir, filename)

        print(f"[{idx}/{len(videos)}] Procesando: {v_title} ({v_id})...")

        if os.path.exists(filepath):
            print(f"  -> Ya existe: {filename}")
            success_count += 1
            continue

        transcript_text = download_transcript(v_id, languages=languages, include_timestamps=include_timestamps)
        
        if transcript_text:
            with open(filepath, "w", encoding="utf-8") as f:
                f.write(f"Título: {v_title}\n")
                f.write(f"URL: https://www.youtube.com/watch?v={v_id}\n")
                f.write("=" * 50 + "\n\n")
                f.write(transcript_text)
            print(f"  ✓ Transcripción guardada en: {filepath}")
            success_count += 1
        else:
            print(f"  ✗ Sin transcripción disponible en los idiomas seleccionados ({', '.join(languages)}).")
            skipped_count += 1

    print("\n" + "=" * 50)
    print(f"Proceso completado:")
    print(f"  - Exitosos/Existentes: {success_count}")
    print(f"  - Sin transcripción: {skipped_count}")
    print(f"  - Carpeta de salida: {os.path.abspath(output_dir)}")
    print("=" * 50)

def main():
    parser = argparse.ArgumentParser(description="Descargar transcripciones de un canal o lista de reproducción de YouTube.")
    parser.add_argument("--url", "-u", required=True, help="URL del canal o lista de reproducción (ej. https://www.youtube.com/@iglesiacmg)")
    parser.add_argument("--output", "-o", default="transcripciones", help="Directorio para guardar los archivos .txt (por defecto: transcripciones)")
    parser.add_argument("--langs", "-l", nargs="+", default=["es", "en"], help="Idiomas preferidos (ej. es en)")
    parser.add_argument("--timestamps", "-t", action="store_true", help="Incluir marcas de tiempo en el archivo .txt")
    parser.add_argument("--max-videos", "-m", type=int, default=None, help="Número máximo de videos a procesar")

    args = parser.parse_args()
    process_channel(
        channel_url=args.url,
        output_dir=args.output,
        languages=args.langs,
        include_timestamps=args.timestamps,
        max_videos=args.max_videos
    )

if __name__ == "__main__":
    main()
