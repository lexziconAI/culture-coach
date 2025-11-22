from sqlalchemy import Column, Integer, String, ForeignKey, DateTime, Text
from sqlalchemy.orm import relationship
from database import Base
import datetime

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True)
    hashed_password = Column(String)

    assessments = relationship("Assessment", back_populates="owner")

class Assessment(Base):
    __tablename__ = "assessments"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    timestamp = Column(DateTime, default=datetime.datetime.utcnow)
    
    # Assessment Data
    user_email = Column(String, nullable=True)
    scores_json = Column(Text) # JSON: {DT: 80, TR: 40...}
    evidence_json = Column(Text) # JSON: List of evidence items
    
    # Report Content
    summary = Column(Text) # Short summary
    full_report = Column(Text) # The comprehensive AI-generated report
    
    owner = relationship("User", back_populates="assessments")
