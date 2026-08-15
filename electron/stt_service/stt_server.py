# stt_server.py - Streaming STT service (VAD + Vosk)
# Continuous recording with automatic sentence segmentation
import sys
import json
import base64
import os
import logging
import struct
import math
import time

# Logging config
logging.basicConfig(level=logging.WARNING, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# ===== Configuration =====
SAMPLE_RATE = 16000
CHUNK_MS = 30
SILENCE_TIMEOUT_MS = 800
MIN_SPEECH_DURATION_MS = 300
CHUNK_SIZE = int(SAMPLE_RATE * CHUNK_MS / 1000)  # 480 samples per 30ms frame at 16kHz

# ===== Pure Python Energy-based VAD =====
def is_speech_energy(frame_bytes, sample_rate=16000, threshold=200):
    """
    基于能量的语音活动检测（纯 Python，无第三方依赖）
    frame_bytes: 30ms 的 16bit PCM 数据
    返回 True 表示有语音，False 表示静音
    """
    if len(frame_bytes) < 10:
        return False
    num_samples = len(frame_bytes) // 2
    samples = struct.unpack(f'{num_samples}h', frame_bytes)
    sum_squares = 0
    for s in samples:
        sum_squares += s * s
    rms = math.sqrt(sum_squares / num_samples)
    return rms > threshold

# ===== Vosk Model Initialization =====
MODEL_PATH = os.path.join(os.path.dirname(__file__), 'models', 'vosk-model-small-cn-0.22')
if not os.path.exists(MODEL_PATH):
    logger.error(f"Model directory not found: {MODEL_PATH}")
    logger.error("Download from https://alphacephei.com/vosk/models vosk-model-small-cn-0.22")
    logger.error("Extract to stt_service/models/vosk-model-small-cn-0.22/")
    sys.exit(1)

try:
    from vosk import Model, KaldiRecognizer
    model = Model(MODEL_PATH)
    logger.info(f"Vosk model loaded: {MODEL_PATH}")
except ImportError as e:
    logger.error(f"Failed to import vosk: {e}")
    logger.error("Install dependencies: pip install -r requirements.txt")
    sys.exit(1)
except Exception as e:
    logger.error(f"Failed to load Vosk model: {e}")
    sys.exit(1)

# ===== Speech State Machine =====
class SpeechState:
    IDLE = 0        # Waiting for speech
    SPEAKING = 1    # Currently speaking
    PAUSING = 2     # Silence detected, waiting for end

class SpeechDetector:
    def __init__(self):
        self.reset()

    def reset(self):
        self.state = SpeechState.IDLE
        self.speech_buffer = bytearray()
        self.silence_counter = 0
        self.speech_start_time = 0
        self.recognizer = KaldiRecognizer(model, SAMPLE_RATE)
        logger.info("Speech detector reset")

    def process_frame(self, frame_bytes):
        """
        Process each 30ms audio frame
        Returns:
            (is_final, text): Sentence complete with recognized text
            (is_final, None): Sentence complete but no text
            None: Continue recording
        """
        # VAD detection (requires 16bit PCM, 16kHz, mono, 30ms frames)
        try:
            is_speech = is_speech_energy(frame_bytes, SAMPLE_RATE, threshold=200)
        except Exception as e:
            logger.warning(f"VAD detection failed: {e}")
            return None

        if self.state == SpeechState.IDLE:
            if is_speech:
                self.state = SpeechState.SPEAKING
                self.speech_buffer = bytearray(frame_bytes)
                self.speech_start_time = time.time()
                self.silence_counter = 0
                logger.debug("Speech started")

        elif self.state == SpeechState.SPEAKING:
            self.speech_buffer.extend(frame_bytes)
            if not is_speech:
                self.silence_counter += CHUNK_MS
                if self.silence_counter >= SILENCE_TIMEOUT_MS:
                    # Silence timeout reached, check speech duration
                    speech_duration_ms = (time.time() - self.speech_start_time) * 1000
                    if speech_duration_ms >= MIN_SPEECH_DURATION_MS:
                        # Valid speech, perform recognition
                        logger.info(f"Sentence end (duration={speech_duration_ms:.0f}ms, silence={self.silence_counter}ms)")
                        text = self.recognize_audio()
                        self.reset()
                        return (True, text)
                    else:
                        # Too short, discard
                        logger.debug(f"Discarded short speech (duration={speech_duration_ms:.0f}ms)")
                        self.reset()
                        return (True, None)
            else:
                self.silence_counter = 0

        elif self.state == SpeechState.PAUSING:
            # Reserved for future use
            pass

        return None

    def recognize_audio(self):
        """
        Recognize buffered audio data
        Uses self.recognizer directly (created in reset()), avoids re-construction
        Returns: recognized text, or None on failure
        """
        try:
            audio_bytes = bytes(self.speech_buffer)
            if len(audio_bytes) == 0:
                return None

            # Feed all audio at once
            self.recognizer.AcceptWaveform(audio_bytes)

            # Get final result
            final_result = json.loads(self.recognizer.Result())
            text = final_result.get('text', '').strip()

            if text:
                logger.info(f"Recognition result: {text}")
                return text
            else:
                logger.debug("Recognition result empty")
                return None
        except Exception as e:
            logger.error(f"Recognition failed: {e}")
            return None

    def force_finalize(self):
        """Force finalize current recognition (used when stopping recording)"""
        if self.state == SpeechState.SPEAKING and len(self.speech_buffer) > 0:
            speech_duration_ms = (time.time() - self.speech_start_time) * 1000
            if speech_duration_ms >= MIN_SPEECH_DURATION_MS:
                text = self.recognize_audio()
                self.reset()
                return (True, text)
        self.reset()
        return None


# ===== Main Loop =====
detector = SpeechDetector()

def send_response(response):
    """Send JSON response to stdout, base64-encode text to avoid encoding issues"""
    # Base64-encode text field in final responses to avoid encoding issues across Python/JS boundary
    if response.get("type") == "final" and response.get("text"):
        text_bytes = response["text"].encode('utf-8')
        response["text"] = base64.b64encode(text_bytes).decode('ascii')
        response["_text_encoded"] = True
    sys.stdout.write(json.dumps(response, ensure_ascii=False) + "\n")
    sys.stdout.flush()

def validate_audio(data):
    """Align audio data to frame boundaries, truncate incomplete trailing frames"""
    frame_size = CHUNK_SIZE * 2
    remainder = len(data) % frame_size
    if remainder != 0:
        data = data[:-remainder]
    return data

def process_audio_data(base64_data):
    """
    Process base64 audio data from frontend
    Audio format: 16kHz, mono, 16bit PCM
    """
    try:
        audio_bytes = base64.b64decode(base64_data)
        # Align frame boundaries to avoid VAD errors
        audio_bytes = validate_audio(audio_bytes)
        frame_size = CHUNK_SIZE * 2  # 16bit = 2 bytes per sample
        num_frames = len(audio_bytes) // frame_size
        # 打印第一帧的 RMS 用于调试
        if num_frames > 0:
            first_frame = audio_bytes[:frame_size]
            num_samples = len(first_frame) // 2
            samples = struct.unpack(f'{num_samples}h', first_frame)
            sum_squares = sum(s*s for s in samples)
            rms = math.sqrt(sum_squares / num_samples)
            logger.debug(f"First frame RMS: {rms}")

        for i in range(num_frames):
            start = i * frame_size
            end = start + frame_size
            frame = audio_bytes[start:end]
            result = detector.process_frame(frame)
            if result is not None:
                is_final, text = result
                if text:
                    return {"type": "final", "text": text}
                else:
                    return {"type": "final", "text": None}
        return None
    except Exception as e:
        logger.error(f"Audio processing failed: {e}")
        return None

def main():
    logger.info("STT service started, waiting for requests...")
    # Send ready signal
    send_response({"type": "ready", "message": "STT service ready"})

    while True:
        try:
            line = sys.stdin.readline()
            if not line:
                break
            line = line.strip()
            if not line:
                continue

            req = json.loads(line)
            action = req.get("action", "")

            if action == "init":
                detector.reset()
                send_response({"type": "init", "success": True})

            elif action == "audio":
                audio_data = req.get("data", "")
                is_last = req.get("isLast", False)
                result = process_audio_data(audio_data)
                if result:
                    send_response(result)
                # If last chunk, force finalize
                if is_last:
                    force_result = detector.force_finalize()
                    if force_result:
                        is_final, text = force_result
                        if text:
                            send_response({"type": "final", "text": text})
                    send_response({"type": "ended"})

            elif action == "reset":
                detector.reset()
                send_response({"type": "reset", "success": True})

            elif action == "end":
                force_result = detector.force_finalize()
                if force_result:
                    is_final, text = force_result
                    if text:
                        send_response({"type": "final", "text": text})
                send_response({"type": "ended"})

            elif action == "quit":
                logger.info("Quit command received")
                break

        except json.JSONDecodeError as e:
            send_response({"type": "error", "error": f"JSON parse error: {e}"})
        except Exception as e:
            send_response({"type": "error", "error": str(e)})

    logger.info("STT service exiting")

if __name__ == "__main__":
    main()