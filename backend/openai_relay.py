import os
import json
import asyncio
import time
import websockets
# from websockets.client import connect # Deprecated
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from dotenv import load_dotenv
from groq import AsyncGroq
from pathlib import Path
import logging

# Setup File Logging for Debugging
logging.basicConfig(
    filename='relay_debug.log', 
    level=logging.DEBUG, 
    format='%(asctime)s - %(levelname)s - %(message)s',
    force=True
)

# Robustly load .env from the same directory as this file
env_path = Path(__file__).parent / ".env"
# Force override to ensure we use the key from the file, not any stale system env var
load_dotenv(dotenv_path=env_path, override=True)

router = APIRouter()

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
logging.info(f"Module-level OPENAI_API_KEY: {OPENAI_API_KEY[:10] if OPENAI_API_KEY else 'None'}")
print(f"DEBUG: Module-level OPENAI_API_KEY: {OPENAI_API_KEY[:10] if OPENAI_API_KEY else 'None'}")

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
GROQ_MODEL = "moonshotai/kimi-k2-instruct-0905" # Kimi K2 on Groq
# GROQ_MODEL = "llama-3.3-70b-versatile"

@router.websocket("/ws/openai-relay")
async def openai_relay(websocket: WebSocket):
    await websocket.accept()
    logging.info(f"Client connected to OpenAI Relay. Websockets version: {websockets.__version__}")
    print(f"Client connected to OpenAI Relay. Websockets version: {websockets.__version__}")
    
    SIDECAR_SYSTEM_PROMPT = """
You are an expert Cultural Intelligence (CQ) Assessor.
Your task is to analyze the ongoing conversation between a User and an AI Coach.
You must output a JSON object that matches the 'updateAssessmentState' tool definition.

The JSON structure is:
{
  "dimensions": {
    "DT": { "score": 0-100, "confidence": "low|medium|high", "evidenceCount": int, "trend": "up|down|stable" },
    "TR": { "score": 0-100, "confidence": "low|medium|high", "evidenceCount": int, "trend": "up|down|stable" },
    "CO": { "score": 0-100, "confidence": "low|medium|high", "evidenceCount": int, "trend": "up|down|stable" },
    "CA": { "score": 0-100, "confidence": "low|medium|high", "evidenceCount": int, "trend": "up|down|stable" },
    "EP": { "score": 0-100, "confidence": "low|medium|high", "evidenceCount": int, "trend": "up|down|stable" }
  },
  "newEvidence": {
    "dimension": "DT|TR|CO|CA|EP",
    "type": "positive|negative|contextual",
    "summary": "One sentence description of the evidence found in this turn.",
    "timestamp": "MM:SS"
  },
  "contradiction": {
    "dimension": "DT|TR|CO|CA|EP",
    "earlyStatement": "Quote from earlier",
    "lateStatement": "Quote from now",
    "resolution": "Explanation of the shift"
  },
  "phase": "OPENING" | "CORE" | "GAP_FILLING" | "VALIDATION" | "CLOSING",
  "isComplete": boolean,
  "summary": "Short summary of the user's cultural profile so far.",
  "strengths": ["strength1", "strength2"],
  "developmentPriorities": ["priority1", "priority2"]
}

Analyze the user's responses for:
- DT: Drive (Motivation)
- TR: Knowledge (Cognition)
- CO: Strategy (Metacognition)
- CA: Action (Behavior)
- EP: Empathy

IMPORTANT: You MUST include the "newEvidence" object in your response for EVERY turn. If there is no strong evidence, provide a "contextual" observation.
Be strict with JSON format. Do not include markdown formatting.
"""

    # Robust Key Loading
    current_key = OPENAI_API_KEY or os.getenv("OPENAI_API_KEY")
    if not current_key:
        load_dotenv(dotenv_path=env_path, override=True)
        current_key = os.getenv("OPENAI_API_KEY")

    if not current_key:
        logging.error("CRITICAL: OPENAI_API_KEY is missing!")
        await websocket.close(code=1008, reason="Missing API Key")
        return

    openai_url = "wss://api.openai.com/v1/realtime?model=gpt-4o-mini-realtime-preview-2024-12-17"
    headers = {
        "Authorization": f"Bearer {current_key}",
        "OpenAI-Beta": "realtime=v1"
    }
    
    # Initialize Sidecar
    groq_client = AsyncGroq(api_key=GROQ_API_KEY)
    conversation_history = [] # List of {"role": "user"|"assistant", "content": "..."}
    
    async def run_sidecar_analysis(history_snapshot):
        """Runs Groq inference in the background and injects the result back to the client."""
        try:
            logging.info(f"[Sidecar] Triggering analysis with {len(history_snapshot)} turns...")
            start_time = time.time()
            
            messages = [
                {"role": "system", "content": SIDECAR_SYSTEM_PROMPT},
                {"role": "user", "content": f"Current Conversation History:\n{json.dumps(history_snapshot, indent=2)}\n\nAnalyze the latest turn and provide the JSON update."}
            ]

            # Use parameters from user's snippet (Kimi K2 specific)
            completion = await groq_client.chat.completions.create(
                model=GROQ_MODEL,
                messages=messages,
                temperature=0.6,
                max_completion_tokens=4096,
                top_p=1,
                stream=False,
                stop=None
            )
            
            result_json_str = completion.choices[0].message.content
            logging.info(f"[Sidecar] Raw JSON: {result_json_str}") # DEBUG LOGGING

            # CLEANUP: Remove markdown code blocks if present
            if "```" in result_json_str:
                import re
                # Remove ```json ... ``` or just ``` ... ```
                result_json_str = re.sub(r'^```json\s*', '', result_json_str)
                result_json_str = re.sub(r'^```\s*', '', result_json_str)
                result_json_str = re.sub(r'\s*```$', '', result_json_str)
                logging.info(f"[Sidecar] Cleaned JSON: {result_json_str}")

            duration = time.time() - start_time
            logging.info(f"[Sidecar] Analysis complete in {duration:.2f}s")

            # Construct the fake tool call event for the frontend
            tool_event = {
                "type": "response.function_call_arguments.done",
                "call_id": f"sidecar_{int(time.time())}",
                "name": "updateAssessmentState",
                "arguments": result_json_str
            }
            
            # Inject into client stream
            await websocket.send_text(json.dumps(tool_event))

        except Exception as e:
            logging.error(f"[Sidecar] Error: {e}")

    try:
        # Use websockets.connect (modern) instead of client.connect
        # Note: websockets 14+ uses 'additional_headers' instead of 'extra_headers'
        async with websockets.connect(openai_url, additional_headers=headers) as openai_ws:
            logging.info("Connected to OpenAI Realtime API")
            print("Connected to OpenAI Realtime API")
            
            # Task to forward messages from Client to OpenAI
            async def client_to_openai():
                try:
                    while True:
                        data = await websocket.receive_text()
                        msg = json.loads(data)

                        # INTERCEPT: Remove tools from session update to prevent OpenAI from blocking
                        if msg.get("type") == "session.update" and "session" in msg:
                            if "tools" in msg["session"]:
                                logging.info("[Relay] Stripping tools from session config (Sidecar will handle them)")
                                del msg["session"]["tools"]
                                # Force tool_choice to none so it doesn't look for them
                                msg["session"]["tool_choice"] = "none"

                        # INTERCEPT: Track User Audio Transcription (if available) or just rely on audio
                        # Note: Client sends 'input_audio_buffer.append'. 
                        # We rely on Server VAD events to know when user spoke, but we need the TEXT.
                        # The server sends 'conversation.item.input_audio_transcription.completed' 
                        # BUT only if we ask for it. We should ensure input_audio_transcription is enabled.
                        
                        # If it's a session update, ensure transcription is on
                        if msg.get("type") == "session.update" and "session" in msg:
                             if "input_audio_transcription" not in msg["session"]:
                                 msg["session"]["input_audio_transcription"] = {"model": "whisper-1"}

                        await openai_ws.send(json.dumps(msg))
                except WebSocketDisconnect:
                    logging.info("Client disconnected")
                except Exception as e:
                    logging.error(f"Error in client_to_openai: {e}")

            # Task to forward messages from OpenAI to Client
            async def openai_to_client():
                try:
                    async for message in openai_ws:
                        msg = json.loads(message)
                        
                        # TRACKING: Build History
                        if msg.get("type") == "conversation.item.input_audio_transcription.completed":
                            transcript = msg.get("transcript", "")
                            if transcript:
                                logging.info(f"[User]: {transcript}")
                                conversation_history.append({"role": "user", "content": transcript})
                                # Trigger Sidecar on User Turn
                                asyncio.create_task(run_sidecar_analysis(list(conversation_history)))

                        elif msg.get("type") == "response.audio_transcript.done":
                            transcript = msg.get("transcript", "")
                            if transcript:
                                logging.info(f"[AI]: {transcript}")
                                conversation_history.append({"role": "assistant", "content": transcript})

                        await websocket.send_text(message)
                except Exception as e:
                    logging.error(f"Error in openai_to_client: {e}")

            # Run both tasks
            await asyncio.gather(client_to_openai(), openai_to_client())

    except Exception as e:
        logging.error(f"OpenAI Connection Error: {e}")
        print(f"OpenAI Connection Error: {e}")
        # Send error to client if possible
        try:
            await websocket.send_text(json.dumps({"type": "error", "message": str(e)}))
        except:
            pass
        await websocket.close()

