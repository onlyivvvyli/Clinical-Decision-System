from sqlalchemy.orm import Session

from app.db.models import Doctor
from app.db.session import SessionLocal


def seed_database():
    db: Session = SessionLocal()
    try:
        existing = db.query(Doctor).filter(Doctor.username == "doctor1").first()
        if not existing:
            db.add(Doctor(username="doctor1", password="123456", name="Dr. Demo"))
            db.commit()
    finally:
        db.close()
