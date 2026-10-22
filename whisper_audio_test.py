import whisper
import tempfile
import os

def test_whisper_with_audio():
    """Test Whisper transcription with actual audio file"""
    print("Testing Whisper transcription with audio file...")
    
    try:
        # Load model
        model = whisper.load_model('base')
        print("✓ Whisper model loaded successfully")
        
        # Create test audio file if it doesn't exist
        test_audio_path = os.path.join(tempfile.gettempdir(), 'test_audio.mp3')
        if not os.path.exists(test_audio_path):
            # Create test audio using ffmpeg
            import subprocess
            result = subprocess.run([
                'ffmpeg', '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=5',
                '-ar', '16000', '-ac', '1', 
                '-f', 'mp3', 
                test_audio_path
            ], capture_output=True, text=True)
            
            if result.returncode != 0:
                print(f"✗ FFmpeg error: {result.stderr}")
                return False
                
        # Test transcription
        print("Testing transcription...")
        result = model.transcribe(test_audio_path, language="es", fp16=False)
        print("✓ Transcription successful!")
        print("Result:", result['text'][:100] + "...")
        return True
        
    except Exception as e:
        print(f"✗ Error: {e}")
        return False

def main():
    print("=" * 50)
    print("Whisper Audio Test")
    print("=" * 50)
    
    success = test_whisper_direct()
    
    print("\n" + "=" * 50)
    if success:
        print("✅ WHISPER TRANSCRIPTION WORKS")
        print("System can transcribe audio files")
    else:
        print("❌ WHISPER TRANSCRIPTION FAILED")
        print("Check audio file format and Whisper setup")
    print("=" * 50)

if __name__ == "__main__":
    test_whisper_direct()