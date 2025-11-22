from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from passlib.context import CryptContext
from jose import JWTError, jwt
from datetime import datetime, timedelta
from typing import List
import os
import json

import models, schemas, database
from openai_relay import router as openai_relay_router
from email_service import send_assessment_email
from dotenv import load_dotenv
from fastapi.middleware.cors import CORSMiddleware

load_dotenv()

# Create tables
models.Base.metadata.create_all(bind=database.engine)

app = FastAPI()

# Add CORS Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173", 
        "http://localhost:5500", 
        "http://127.0.0.1:5173", 
        "http://127.0.0.1:5500",
        "https://culture-coach-frontend.onrender.com"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include OpenAI Relay Router
app.include_router(openai_relay_router)

# Dependency
def get_db():
    db = database.SessionLocal()
    try:
        yield db
    finally:
        db.close()

# --- Auth Configuration ---
SECRET_KEY = os.getenv("SECRET_KEY", "your-secret-key-change-in-production-12345")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30

pwd_context = CryptContext(schemes=["argon2"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="api/token")

def verify_password(plain_password, hashed_password):
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password):
    return pwd_context.hash(password)

def create_access_token(data: dict, expires_delta: timedelta | None = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=15)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

async def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        email: str = payload.get("sub")
        if email is None:
            raise credentials_exception
        token_data = schemas.TokenData(email=email)
    except JWTError:
        raise credentials_exception
    user = db.query(models.User).filter(models.User.email == token_data.email).first()
    if user is None:
        raise credentials_exception
    return user

# --- API Endpoints ---

@app.post("/api/register", response_model=schemas.User)
def register(user: schemas.UserCreate, db: Session = Depends(get_db)):
    db_user = db.query(models.User).filter(models.User.email == user.email).first()
    if db_user:
        raise HTTPException(status_code=400, detail="Email already registered")
    hashed_password = get_password_hash(user.password)
    new_user = models.User(email=user.email, hashed_password=hashed_password)
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return new_user

@app.post("/api/token", response_model=schemas.Token)
async def login_for_access_token(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.email == form_data.username).first()
    if not user or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": user.email}, expires_delta=access_token_expires
    )
    return {"access_token": access_token, "token_type": "bearer"}

@app.get("/api/users/me", response_model=schemas.User)
async def read_users_me(current_user: models.User = Depends(get_current_user)):
    return current_user

from groq import AsyncGroq

@app.post("/api/generate-report", response_model=schemas.Assessment)
async def generate_report(request: schemas.ReportRequest, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    # 1. Generate Report using Groq
    groq_client = AsyncGroq(api_key=os.getenv("GROQ_API_KEY"))
    
    # Helper to normalize score to 0-100
    def get_score(dim_code):
        val = request.dimensions.get(dim_code, {}).get('score', 0)
        return val * 20 if val <= 5 else val

    prompt = f"""
    You are an expert Cultural Intelligence Coach. Write a comprehensive, personalized assessment report for a user based on their session data.
    
    User Email: {request.email}
    
    SCORES (0-100):
    - Directness (DT): {get_score('DT')}
    - Task/Relational (TR): {get_score('TR')}
    - Conflict (CO): {get_score('CO')}
    - Adaptability (CA): {get_score('CA')}
    - Empathy (EP): {get_score('EP')}
    
    STRENGTHS: {', '.join(request.strengths)}
    PRIORITIES: {', '.join(request.developmentPriorities)}
    
    EVIDENCE LOG:
    {json.dumps(request.evidenceLog, indent=2)}
    
    SUMMARY: {request.summary}
    
    Please write a professional, encouraging, and actionable report in Markdown format.
    Structure it with:
    1. Executive Summary
    2. Detailed Dimension Analysis (highlighting key evidence)
    3. Actionable Development Plan
    """
    
    try:
        completion = await groq_client.chat.completions.create(
            model="moonshotai/kimi-k2-instruct-0905",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.7,
            max_completion_tokens=2048
        )
        full_report = completion.choices[0].message.content
    except Exception as e:
        print(f"Error generating report: {e}")
        full_report = "Report generation failed. Please contact support."

    # 2. Save to Database
    scores_json = json.dumps(request.dimensions)
    evidence_json = json.dumps(request.evidenceLog)
    
    db_assessment = models.Assessment(
        user_id=current_user.id,
        user_email=request.email,
        scores_json=scores_json,
        evidence_json=evidence_json,
        summary=request.summary,
        full_report=full_report
    )
    db.add(db_assessment)
    db.commit()
    db.refresh(db_assessment)
    
    return db_assessment

@app.post("/api/assessments", response_model=schemas.Assessment)
def create_assessment(assessment: schemas.AssessmentCreate, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    db_assessment = models.Assessment(
        user_id=current_user.id,
        user_email=current_user.email,  # Ensure we have the email
        scores_json=json.dumps(assessment.scores),
        evidence_json=json.dumps(assessment.evidence),
        summary=assessment.summary,
        full_report=assessment.full_report
    )
    db.add(db_assessment)
    db.commit()
    db.refresh(db_assessment)
    return db_assessment

@app.get("/api/assessments", response_model=List[schemas.Assessment])
def read_assessments(skip: int = 0, limit: int = 100, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    assessments = db.query(models.Assessment).filter(models.Assessment.user_id == current_user.id).order_by(models.Assessment.timestamp.desc()).offset(skip).limit(limit).all()
    return assessments

class FinalizeSessionRequest(schemas.BaseModel):
    email: str
    assessment: dict

@app.post("/api/finalize-session")
async def finalize_session(request: FinalizeSessionRequest, db: Session = Depends(get_db)):
    print(f"Finalizing session for {request.email}")

    # --- Generate Comprehensive AI Report ---
    try:
        groq_client = AsyncGroq(api_key=os.getenv("GROQ_API_KEY"))
        
        # Helper to normalize score to 0-100
        def get_score(dim_code):
            val = request.assessment.get('dimensions', {}).get(dim_code, {}).get('score', 0)
            # If score is 0-5, scale to 100. If already > 5, assume 100 scale.
            return int(val * 20) if val <= 5 else int(val)

        scores_text = "\n".join([
            f"- Directness & Transparency (DT): {get_score('DT')}/100",
            f"- Task vs Relational (TR): {get_score('TR')}/100",
            f"- Conflict Orientation (CO): {get_score('CO')}/100",
            f"- Cultural Adaptability (CA): {get_score('CA')}/100",
            f"- Empathy & Perspective (EP): {get_score('EP')}/100"
        ])

        prompt = f"""
        You are an expert Cultural Intelligence Coach. Write a comprehensive, personalized assessment report for a user based on their session data.
        Output the report in clean HTML format (no markdown backticks, just the HTML content starting with <div>).

        User Email: {request.email}

        SCORES:
        {scores_text}

        SESSION SUMMARY: {request.assessment.get('summary', '')}
        
        EVIDENCE LOG:
        {json.dumps(request.assessment.get('evidenceLog', []), indent=2)}

        REQUIREMENTS:
        1. **Executive Summary**: A personalized overview of their performance.
        2. **Dimension Analysis**: For EACH of the 5 dimensions (DT, TR, CO, CA, EP):
           - Provide a clear **Definition** of the dimension.
           - Display their **Score** (e.g., 85/100).
           - Explain the score based on specific evidence from the log.
        3. **Key Strengths**: Identify exactly **3** specific strengths shown in the session.
        4. **Developmental Areas**: Identify exactly **3** specific areas for improvement.
        5. **Practical Recommendations**: Provide **3** concrete, actionable steps they can take immediately.
        6. **Reflection Questions**: Ask **4** deep, personalized questions to help them grow.

        TONE: Professional, encouraging, insightful, and deeply tailored to the evidence provided.
        FORMAT: Use <h2> for section headers, <h3> for subsections, <p> for text, and <ul>/<li> for lists. Use inline CSS for basic styling (e.g., color: #4f46e5 for headers).
        IMPORTANT: DO NOT include any footer, copyright notice, or closing signature (e.g. "© 2024..."). The system will append the official footer automatically.
        """

        completion = await groq_client.chat.completions.create(
            model="moonshotai/kimi-k2-instruct-0905",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.7,
            max_completion_tokens=4096
        )
        
        ai_report_html = completion.choices[0].message.content
        # Strip markdown code blocks if present
        ai_report_html = ai_report_html.replace("```html", "").replace("```", "")
        
        # Inject into assessment data
        request.assessment['ai_report_html'] = ai_report_html

    except Exception as e:
        print(f"Error generating AI report: {e}")
        # Fallback to basic report if AI fails
        pass

    # 2. Send Email
    success = send_assessment_email(request.email, request.assessment)
    
    if not success:
        raise HTTPException(status_code=500, detail="Failed to send email report")
        
    return {"status": "success", "message": "Report sent successfully"}

# --- Static Files (React App) ---
# Serve static files from the 'dist' directory
# We need to go up one level from 'backend' to find 'dist'
DIST_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "dist")

if os.path.exists(DIST_DIR):
    app.mount("/assets", StaticFiles(directory=os.path.join(DIST_DIR, "assets")), name="assets")
    # You might need to mount other folders if they exist in dist, e.g. favicon
    
    @app.get("/{full_path:path}")
    async def serve_react_app(full_path: str):
        # If API request, return 404 (should be handled by API routes above)
        if full_path.startswith("api/"):
             raise HTTPException(status_code=404, detail="Not Found")
        
        # Check if file exists in dist
        file_path = os.path.join(DIST_DIR, full_path)
        if os.path.exists(file_path) and os.path.isfile(file_path):
            return FileResponse(file_path)
        
        # Otherwise return index.html for SPA routing
        return FileResponse(os.path.join(DIST_DIR, "index.html"))
else:
    print(f"WARNING: dist directory not found at {DIST_DIR}. Run 'npm run build' first.")

