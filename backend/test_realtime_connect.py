import os
import asyncio
import websockets
from dotenv import load_dotenv
from pathlib import Path

# Load env
env_path = Path(__file__).parent / ".env"
load_dotenv(dotenv_path=env_path, override=True)

api_key = os.getenv("OPENAI_API_KEY")
print(f"Loaded API Key: {api_key[:10]}... (Length: {len(api_key) if api_key else 0})")

async def test_connect():
    url = "wss://api.openai.com/v1/realtime?model=gpt-4o-mini-realtime-preview-2024-12-17"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "OpenAI-Beta": "realtime=v1"
    }
    
    print(f"Connecting to {url}")
    print(f"Headers: {headers}")
    
    import inspect
    try:
        print(f"Signature: {inspect.signature(websockets.connect)}")
    except Exception as e:
        print(f"Could not get signature: {e}")

    try:
        # Test 1: No headers (expect 401 or 403, but no TypeError)
        print("--- Test 1: No Headers ---")
        try:
            async with websockets.connect(url) as ws:
                print("✅ Connected successfully (Unexpected without auth)!")
                await ws.close()
        except Exception as e:
            print(f"Result: {e}")

        # Test 2: With additional_headers (Correct for websockets 15+)
        print("\n--- Test 2: With additional_headers ---")
        try:
            async with websockets.connect(url, additional_headers=headers) as ws:
                print("✅ Connected successfully!")
                await ws.close()
        except Exception as e:
            print(f"Result: {e}")

    except Exception as e:
        print(f"❌ Outer error: {e}")

if __name__ == "__main__":
    asyncio.run(test_connect())
