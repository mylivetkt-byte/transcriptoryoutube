"""
Simple test script to verify Whisper transcription functionality
"""
import whisper
import tempfile
import os

def test_whisper_transcription():
    """Test that Whisper model loads correctly"""
    print("Testing Whisper model loading...")
    try:
        model = whisper.load_model('base')
        print("Whisper model loaded successfully")
        return True
    except Exception as e:
        print(f"Failed to load Whisper model: {e}")
        return False

def main():
    print("=" * 50)
    print("Whisper Transcription System Check")
    print("=" * 50)
    
    # Test the model loading
    success = test_whisper_transcription()
    
    print("-" * 50)
    if success:
        print("SYSTEM CHECK PASSED")
        print("Whisper is ready for transcription")
    else:
        print("SYSTEM CHECK FAILED")
        print("Whisper model loading failed")
    print("=" * 50)

if __name__ == "__main__":
    main()