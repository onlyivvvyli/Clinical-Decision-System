from datetime import datetime

from sqlalchemy import DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class Doctor(Base):
    __tablename__ = "doctors"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    username: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    password: Mapped[str] = mapped_column(String(255), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)


class PrescriptionLog(Base):
    __tablename__ = "prescription_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    doctor_id: Mapped[int] = mapped_column(Integer, nullable=False)
    patient_id: Mapped[str] = mapped_column(String(255), nullable=False)
    medication_name: Mapped[str] = mapped_column(String(255), nullable=False)
    medication_code: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    decision: Mapped[str] = mapped_column(String(50), nullable=False)
    alert_summary: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
