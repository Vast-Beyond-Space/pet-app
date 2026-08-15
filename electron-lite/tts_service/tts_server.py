# -*- coding: utf-8 -*-
# tts_server.py - Edge TTS 版本
# 使用 edge-tts 进行在线语音合成，返回 Base64 编码的 MP3 音频数据

import sys
import json
import base64
import logging
import asyncio
import re

import edge_tts

# 仅记录 WARNING 及以上，避免每次合成都刷 INFO 日志（Step1/2/3、Synthesis successful 等）
logging.basicConfig(level=logging.WARNING, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# 默认中文语音
DEFAULT_VOICE = "zh-CN-XiaoxiaoNeural"


def clean_text(text):
    """清理文本，移除特殊标记和 emoji"""
    if not text:
        return ''
    clean = text
    clean = clean.replace('<TOOL:', '')
    clean = clean.replace('[AGENT_MODE]', '')
    clean = clean.replace('<MOOD:', '')
    clean = clean.replace('<CMD:', '')
    clean = clean.replace('>', '').replace(']', '')

    # 移除 emoji
    emoji_pattern = re.compile("["
        u"\U0001F600-\U0001F64F"
        u"\U0001F300-\U0001F5FF"
        u"\U0001F680-\U0001F6FF"
        u"\U0001F1E0-\U0001F1FF"
        u"\U00002702-\U000027B0"
        u"\U000024C2-\U0001F251"
        "]+", flags=re.UNICODE)
    clean = emoji_pattern.sub('', clean)
    clean = re.sub(r'\s+', ' ', clean).strip()
    return clean


async def synthesize_async(text, voice):
    """使用 Edge TTS 异步合成语音"""
    communicate = edge_tts.Communicate(text, voice)
    audio_data = bytearray()
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            audio_data += chunk["data"]
    return bytes(audio_data)


def synthesize(text, voice=DEFAULT_VOICE):
    """
    合成语音，返回 base64 编码的 MP3 音频数据

    Args:
        text: 要合成的文本
        voice: 语音名称（如 zh-CN-XiaoxiaoNeural）

    Returns:
        base64 编码的音频数据，失败返回 None
    """
    try:
        # Step 1: 不再清理文本，直接使用原始 text
        # clean = clean_text(text)
        # if not clean:
        #     logger.error("Step 1 failed: cleaned text is empty")
        #     return None
        # logger.info(f"Step 1 OK: cleaned text: '{clean[:50]}...' " if len(clean) > 50 else f"Step 1 OK: cleaned text: '{clean}'")

        # 直接使用原始文本
        clean = text  # 直接赋值，跳过清理
        logger.info(f"Step 1 (skipped): using raw text: '{clean[:50]}...' " if len(clean) > 50 else f"Step 1 (skipped): using raw text: '{clean}'")

        # Step 2: 调用 Edge TTS 合成
        logger.info(f"Step 2: Synthesizing with voice '{voice}'...")
        try:
            audio_bytes = asyncio.run(synthesize_async(clean, voice))
        except ValueError as e:
            if "Invalid voice" in str(e):
                logger.warning(f"Invalid voice '{voice}', retry with default '{DEFAULT_VOICE}'")
                audio_bytes = asyncio.run(synthesize_async(clean, DEFAULT_VOICE))
            else:
                raise
        if not audio_bytes:
            logger.error("Step 2 failed: no audio data returned")
            return None
        logger.info(f"Step 2 OK: raw audio bytes={len(audio_bytes)}")

        # Step 3: 编码为 base64
        b64 = base64.b64encode(audio_bytes).decode('utf-8')
        logger.info(f"Step 3 OK: base64 length={len(b64)}")
        logger.info(f"Synthesis successful: {len(audio_bytes)} bytes, voice={voice}")
        return b64

    except Exception as e:
        logger.error(f"Synthesis exception: {e}", exc_info=True)
        return None


def main():
    logger.info("Edge TTS service started, waiting for requests...")
    logger.info(f"Default voice: {DEFAULT_VOICE}")

    # 预热：测试 Edge TTS 是否可用
    try:
        logger.info("Testing Edge TTS connectivity...")
        test = asyncio.run(synthesize_async("测试", DEFAULT_VOICE))
        if test:
            logger.info("Edge TTS connectivity OK")
        else:
            logger.warning("Edge TTS returned empty data")
    except Exception as e:
        logger.warning(f"Edge TTS connectivity test failed (non-fatal): {e}")

    while True:
        try:
            # 从 stdin 读取一行 JSON
            line = sys.stdin.readline()
            if not line:
                break
            line = line.strip()
            if not line:
                continue

            req = json.loads(line)
            text = req.get("text", "")
            voice = req.get("voice", DEFAULT_VOICE)
            request_id = req.get("request_id", None)
            # Decode base64 text if encoded by main.js
            if req.get("_text_encoded"):
                text = base64.b64decode(text).decode('utf-8')

            if not text:
                response = {"success": False, "error": "text is empty", "request_id": request_id}
            else:
                audio_b64 = synthesize(text, voice)
                if audio_b64:
                    response = {"success": True, "audio": audio_b64, "request_id": request_id}
                else:
                    response = {"success": False, "error": "synthesis failed", "request_id": request_id}

            # 将 JSON 响应写入 stdout
            sys.stdout.write(json.dumps(response) + "\n")
            sys.stdout.flush()

        except json.JSONDecodeError as e:
            response = {"success": False, "error": f"JSON parse error: {e}"}
            sys.stdout.write(json.dumps(response) + "\n")
            sys.stdout.flush()
        except Exception as e:
            response = {"success": False, "error": str(e)}
            sys.stdout.write(json.dumps(response) + "\n")
            sys.stdout.flush()


if __name__ == "__main__":
    main()