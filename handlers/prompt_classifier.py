"""
Prompt classifier using Gemma 3 12B for analyzing user intent and image content.
Uses lightweight multimodal model for quick classification tasks before main processing.
"""
import logging
import google.generativeai as genai

CLASSIFIER_MODEL = "gemma-3-12b-it"
CLASSIFICATION_TEMPERATURE = 0  # Zero temperature for consistent yes/no answers


async def analyze_user_intent(prompt: str, images: list = None) -> dict:
    """
    Analyze user's prompt and images to understand their intent.
    
    IMPORTANT: Only runs classification when images are provided.
    If no images, returns False for all checks since there's nothing to improve or analyze.
    
    Uses Gemma 3 12B with temperature=0 for accurate classification.
    
    Args:
        prompt: User's input text describing what they want
        images: List of PIL Image objects (optional)
        
    Returns:
        dict with classification results:
        {
            "wants_ctr_improvement": bool,  # True if user wants CTR optimization
            "raw_ctr_response": str          # Raw CTR model response for debugging
        }
    """
    # If no images provided, skip all checks
    if not images or len(images) == 0:
        logging.info("[PromptClassifier] No images provided, skipping classification")
        return {
            "wants_ctr_improvement": False,
            "raw_ctr_response": "skipped: no images"
        }
    
    try:
        model = genai.GenerativeModel(CLASSIFIER_MODEL)
        
        # 1. Check CTR improvement intent (text-only)
        ctr_prompt = f"""Analyze the following user request and determine if the user wants to improve CTR (Click-Through Rate) for their product, advertisement, or marketplace listing.

User request: "{prompt}"

Answer with ONLY "yes" or "no".
- Answer "yes" if the user explicitly or implicitly wants to improve CTR, increase clicks, optimize conversion, make their product more attractive to buyers, or improve marketplace performance.
- Answer "no" for all other requests like general image creation, editing, artistic requests, or unrelated tasks.

Answer:"""

        ctr_response = await model.generate_content_async(
            ctr_prompt,
            generation_config=genai.GenerationConfig(
                temperature=CLASSIFICATION_TEMPERATURE,
                max_output_tokens=10
            )
        )
        
        ctr_answer = ctr_response.text.strip().lower()
        wants_ctr = ctr_answer.startswith("yes")
        
        logging.info(f"[PromptClassifier] CTR intent: {ctr_answer}")
        
        return {
            "wants_ctr_improvement": wants_ctr,
            "raw_ctr_response": ctr_answer
        }
        
    except Exception as e:
        logging.error(f"[PromptClassifier] Error analyzing intent: {e}", exc_info=True)
        # Default to False on error to avoid breaking the main flow
        return {
            "wants_ctr_improvement": False,
            "raw_ctr_response": f"error: {str(e)}"
        }
