import whisper
import tempfile
import os

def test_whisper_direct():
    """Test Whisper transcription with a sample audio file"""
    print("Testing Whisper transcription...")
    try:
        model = whisper.load_model('base')
        print("Model loaded successfully")
        
        # Test with a sample audio file (simulated)
        # In real usage, this would be a downloaded audio file
        test_file = os.path.join(tempfile.gettempdir(), 'test_audio.txt')
        with open(test_file, 'w') as f:
            f.write('This is a test of the Whisper transcription system.')
            
        print("Testing transcription...")
        result = model.transcribe(test_file, language="es", fp16=False)
        print("Transcription successful!")
        print("Result:", result['text'][:100] + "...")
        return True
        
    except Exception as e:
        print(f"Error: {e}")
        return False

def main():
    print("=" * 50)
    print("Whisper System Check")
    print("=" * 50)
    
    success = test_whisper_direct()
    
    print("-" * 50)
    if success:
        print("✓ SYSTEM VERIFICATION PASSED")
        print("Whisper is ready for transcription")
    else:
        print("✗ WHISPER SYSTEM FAILED")
    print("=" * 50)

if __name__ == "__main__":
    test_whisper_direct()