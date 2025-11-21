from fastapi.testclient import TestClient
from backend.main import app
import sys
import os

# Ensure we can import backend
sys.path.append(os.getcwd())

client = TestClient(app)

def test_register():
    print("Testing registration...")
    response = client.post(
        "/api/register",
        json={"username": "test_unit_user", "password": "password123"}
    )
    print(f"Status: {response.status_code}")
    print(f"Response: {response.text}")
    
    if response.status_code == 200:
        print("Registration successful!")
    elif response.status_code == 400 and "already registered" in response.text:
        print("User already exists (expected if run multiple times)")
    else:
        print("Registration FAILED")

if __name__ == "__main__":
    test_register()
