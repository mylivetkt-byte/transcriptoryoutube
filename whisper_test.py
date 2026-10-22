import whisper
import tempfile
import os

def test_whisper_direct():
    """Test Whisper transcription with a sample audio file"""
    print("Testing Whisper transcription directly...")
    
    # Load model
    try:
        model = whisper.load_model('base')
        print("✓ Whisper model loaded successfully")
    except Exception as e:
        print(f"✗ Failed to load Whisper model: {e}")
        return False
    
    # Create a sample audio file for testing
    with tempfile.TemporaryDirectory() as tmpdir:
        # Create a dummy audio file (Whisper needs actual audio)
        test_audio = os.path.join(tmpdir, 'test_audio.wav')
        
        # For testing purposes, we'll create a simple text file to simulate audio
        # In a real scenario, this would be an actual audio file
        test_file = os.path.join(tmpdir, 'test.wav')
        with open(test_file, 'w') as f:
            f.write('This is a test audio file for transcription purposes only.')
            
        print("Testing transcription with sample audio...")
        try:
            # This simulates what transcribe_with_whisper would do
            # In real usage, it would download audio first, then call model.transcribe()
            result = model.transcribe(test_file, language="es", fp16=False)
            print("✓ Transcription successful!")
            print("Transcription result:", result['text'][:100] + "...")
            return True
            
        except Exception as e:
            print(f"✗ Transcription failed: {e}")
            return False

def main():
    print("=" * 50)
    print("Whisper System Verification")
    print("=" * 50)
    
    success = test_whisper_direct()
    
    print("-" * 50)
    if success:
        print("✅ WHISPER IS WORKING CORRECTLY")
        print("System is ready for video transcription")
    else:
        print("❌ WHISPER IS NOT WORKING")
        print("There may be an issue with the Whisper implementation")
    print("=" * 50)

if __name__ == "__main__":
    test_whisper_direct()