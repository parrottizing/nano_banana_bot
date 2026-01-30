"""
LaoZhang API client for Nano Banana Bot.
Provides centralized API calls for image generation and text analysis.
"""
import os
import base64
import logging
import aiohttp
from io import BytesIO
from typing import Optional, List
from PIL import Image

# API Configuration
LAOZHANG_BASE_URL = "https://api.laozhang.ai/v1beta/models"

# Default model names
IMAGE_MODEL = "gemini-3-pro-image-preview-2k"
TEXT_MODEL = "gemini-3-flash-preview"
CLASSIFIER_MODEL = "gemma-3-12b-it"

# Default image settings
DEFAULT_ASPECT_RATIO = "3:4"  # Vertical for marketplace cards
DEFAULT_IMAGE_SIZE = "2K"

# Request timeout
REQUEST_TIMEOUT = 180  # seconds


def _get_headers():
    """Get authorization headers for API requests."""
    # Read API key at request time (not import time) to ensure dotenv is loaded
    api_key = os.getenv("LAOZHANG_API_KEY")
    if not api_key:
        logging.error("[LaoZhangClient] LAOZHANG_API_KEY not found in environment!")
    return {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }


def _pil_image_to_base64(image: Image.Image, mime_type: str = "image/jpeg") -> str:
    """Convert PIL Image to base64 string."""
    buffer = BytesIO()
    # Use appropriate format based on mime type
    fmt = "PNG" if "png" in mime_type else "JPEG"
    image.save(buffer, format=fmt)
    return base64.b64encode(buffer.getvalue()).decode("utf-8")


async def generate_image(
    prompt: str,
    images: Optional[List] = None,
    aspect_ratio: str = DEFAULT_ASPECT_RATIO,
    image_size: str = DEFAULT_IMAGE_SIZE,
    model: str = IMAGE_MODEL
) -> Optional[bytes]:
    """
    Generate an image using LaoZhang API.
    
    Args:
        prompt: Text prompt for image generation
        images: Optional list of PIL Image objects for image-to-image
        aspect_ratio: Aspect ratio (e.g., "1:1", "3:4", "16:9")
        image_size: Resolution ("1K", "2K", "4K")
        model: Model name to use
        
    Returns:
        Image data as bytes, or None on failure
    """
    url = f"{LAOZHANG_BASE_URL}/{model}:generateContent"
    
    # Build parts: text prompt first, then images
    parts = [{"text": prompt}]
    
    if images:
        for img in images:
            img_base64 = _pil_image_to_base64(img)
            parts.append({
                "inline_data": {
                    "mime_type": "image/jpeg",
                    "data": img_base64
                }
            })
    
    payload = {
        "contents": [{"parts": parts}],
        "generationConfig": {
            "responseModalities": ["IMAGE"],
            "imageConfig": {
                "aspectRatio": aspect_ratio,
                "imageSize": image_size
            }
        }
    }
    
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                url,
                headers=_get_headers(),
                json=payload,
                timeout=aiohttp.ClientTimeout(total=REQUEST_TIMEOUT)
            ) as response:
                if response.status != 200:
                    error_text = await response.text()
                    logging.error(f"[LaoZhangClient] Image generation failed: {response.status} - {error_text}")
                    return None
                
                result = await response.json()
                
                # Extract image data from response
                try:
                    image_data = result["candidates"][0]["content"]["parts"][0]["inlineData"]["data"]
                    return base64.b64decode(image_data)
                except (KeyError, IndexError) as e:
                    logging.error(f"[LaoZhangClient] Failed to extract image from response: {e}")
                    logging.debug(f"[LaoZhangClient] Response: {result}")
                    return None
                    
    except aiohttp.ClientError as e:
        logging.error(f"[LaoZhangClient] HTTP error during image generation: {e}")
        return None
    except Exception as e:
        logging.error(f"[LaoZhangClient] Unexpected error during image generation: {e}", exc_info=True)
        return None


async def generate_text(
    prompt: str,
    images: Optional[List] = None,
    model: str = TEXT_MODEL,
    temperature: Optional[float] = None,
    max_output_tokens: Optional[int] = None
) -> Optional[str]:
    """
    Generate text using LaoZhang API.
    
    Args:
        prompt: Text prompt
        images: Optional list of PIL Image objects for multimodal input
        model: Model name to use
        temperature: Optional temperature setting
        max_output_tokens: Optional max tokens limit
        
    Returns:
        Generated text, or None on failure
    """
    url = f"{LAOZHANG_BASE_URL}/{model}:generateContent"
    
    # Build parts: text prompt first, then images
    parts = [{"text": prompt}]
    
    if images:
        for img in images:
            img_base64 = _pil_image_to_base64(img)
            parts.append({
                "inline_data": {
                    "mime_type": "image/jpeg",
                    "data": img_base64
                }
            })
    
    payload = {
        "contents": [{"parts": parts}],
        "generationConfig": {
            "responseModalities": ["TEXT"]
        }
    }
    
    # Add optional generation config
    if temperature is not None:
        payload["generationConfig"]["temperature"] = temperature
    if max_output_tokens is not None:
        payload["generationConfig"]["maxOutputTokens"] = max_output_tokens
    
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                url,
                headers=_get_headers(),
                json=payload,
                timeout=aiohttp.ClientTimeout(total=REQUEST_TIMEOUT)
            ) as response:
                if response.status != 200:
                    error_text = await response.text()
                    logging.error(f"[LaoZhangClient] Text generation failed: {response.status} - {error_text}")
                    return None
                
                result = await response.json()
                
                # Extract text from response
                try:
                    text = result["candidates"][0]["content"]["parts"][0]["text"]
                    return text
                except (KeyError, IndexError) as e:
                    logging.error(f"[LaoZhangClient] Failed to extract text from response: {e}")
                    logging.debug(f"[LaoZhangClient] Response: {result}")
                    return None
                    
    except aiohttp.ClientError as e:
        logging.error(f"[LaoZhangClient] HTTP error during text generation: {e}")
        return None
    except Exception as e:
        logging.error(f"[LaoZhangClient] Unexpected error during text generation: {e}", exc_info=True)
        return None
