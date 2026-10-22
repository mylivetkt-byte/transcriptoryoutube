import whisper
import tempfile
import os
import yt_dlp

def test_whisper():
    print("Testing Whisper transcription...")
    try:
        model = whisper.load_model('base')
        print("Model loaded successfully")
        
        test_video_id = 'dQw4w9WgXcQ'
        
        with tempfile.TemporaryDirectory() as tmpdir:
            ydl_opts = {
                'format': 'bestaudio/best',
                'outtmpl': os.path.join(tmpdir, '%(title)s.%(ext)s'),
                'quiet': True,
                'no_warnings': True,
            }
            
            try:
                with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                    print('Downloading audio...')
                    ydl.download([f'https://www.youtube.com/watch?v={test_video_id}'])
                    print('Download complete')
                    
                    files = os.listdir(tmpdir)
                    print('Files created:', files)
                    
            except Exception as e:
                print(f'Error: {e}')
                
    except Exception as e:
        print(f'Error: {e}')

if __name__ == '__main__':
    test_whisper()