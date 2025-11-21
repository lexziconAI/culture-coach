from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime

class AssessmentBase(BaseModel):
    scores_json: str
    evidence_json: Optional[str] = None
    summary: Optional[str] = None
    full_report: Optional[str] = None
    user_email: Optional[str] = None

class AssessmentCreate(AssessmentBase):
    pass

class ReportRequest(BaseModel):
    email: str
    dimensions: dict
    evidenceLog: list
    strengths: list
    developmentPriorities: list
    summary: str

class Assessment(AssessmentBase):
    id: int
    user_id: int
    timestamp: datetime

    class Config:
        from_attributes = True

class UserBase(BaseModel):
    username: str

class UserCreate(UserBase):
    password: str

class User(UserBase):
    id: int
    assessments: List[Assessment] = []

    class Config:
        from_attributes = True

class Token(BaseModel):
    access_token: str
    token_type: str

class TokenData(BaseModel):
    username: Optional[str] = None
