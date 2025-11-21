import os
import sys
from pathlib import Path
from dotenv import load_dotenv
import asyncio
from groq import AsyncGroq

# 1. Load Environment Variables
print("--- SMOKE TEST START ---")
current_dir = Path(__file__).parent
env_path = current_dir / ".env"
print(f"Looking for .env at: {env_path}")

if not env_path.exists():
    print("❌ .env file NOT FOUND!")
else:
    print("✅ .env file found.")

# Force override
load_dotenv(dotenv_path=env_path, override=True)

# 2. Check Keys
openai_key = os.getenv("OPENAI_API_KEY")
groq_key = os.getenv("GROQ_API_KEY")

print(f"\n[OPENAI_API_KEY]")
if openai_key:
    print(f"  Raw Repr: {repr(openai_key)}")
    print(f"  Value: {openai_key[:10]}...{openai_key[-4:]}")
    print(f"  Length: {len(openai_key)}")
    if openai_key == "None":
        print("  ❌ WARNING: Key is the string 'None'!")
    elif openai_key.startswith("sk-"):
        print("  ✅ Format looks correct (starts with sk-)")
    else:
        print("  ⚠️ Format warning: Does not start with sk-")
else:
    print("  ❌ Value is None/Empty")

print(f"\n[GROQ_API_KEY]")
if groq_key:
    print(f"  Raw Repr: {repr(groq_key)}")
    print(f"  Value: {groq_key[:10]}...{groq_key[-4:]}")
    print(f"  Length: {len(groq_key)}")
else:
    print("  ❌ Value is None/Empty")

# 3. Test Groq Connection (Simple)
async def test_groq():
    print("\n--- Testing Groq Connection ---")
    if not groq_key:
        print("Skipping Groq test (no key)")
        return

    client = AsyncGroq(api_key=groq_key)
    try:
        completion = await client.chat.completions.create(
            model="llama-3.3-70b-versatile", # Updated model
            messages=[{"role": "user", "content": "Say hello"}],
            max_tokens=10
        )
        print(f"✅ Groq Response: {completion.choices[0].message.content}")
    except Exception as e:
        print(f"❌ Groq Error: {e}")

import websockets
from websockets.client import connect

# ... existing code ...

# 4. Test OpenAI Key (WebSocket)
async def test_openai_ws():
    print("\n--- Testing OpenAI Key (WebSocket) ---")
    if not openai_key:
        print("Skipping OpenAI WS test (no key)")
        return
        
    url = "wss://api.openai.com/v1/realtime?model=gpt-4o-mini-realtime-preview-2024-12-17"
    headers = {
        "Authorization": f"Bearer {openai_key}",
        "OpenAI-Beta": "realtime=v1"
    }
    
    print(f"Connecting to {url}...")
    print(f"Headers: Authorization=Bearer {openai_key[:5]}... (len={len(openai_key)})")
    
    try:
        async with connect(url, extra_headers=headers) as ws:
            print("✅ OpenAI WebSocket Connected Successfully!")
            # Send a simple message or just close
            await ws.close()
    except Exception as e:
        print(f"❌ OpenAI WebSocket Error: {e}")

async def main():
    await test_groq()
    # await test_openai_http() # Skip HTTP test, focus on WS
    await test_openai_ws()
    print("\n--- SMOKE TEST END ---")


if __name__ == "__main__":
    asyncio.run(main())
