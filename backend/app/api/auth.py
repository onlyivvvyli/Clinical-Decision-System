from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db.models import Doctor
from app.db.session import get_db
from app.schemas.auth import LoginRequest, LoginResponse

router = APIRouter()


@router.post("/login", response_model=LoginResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    doctor = (
        db.query(Doctor)
        .filter(Doctor.username == payload.username, Doctor.password == payload.password)
        .first()
    )
    if not doctor:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password.",
        )

    return LoginResponse(
        success=True,
        token=f"doctor-{doctor.id}",
        doctor={
            "id": doctor.id,
            "name": doctor.name,
            "username": doctor.username,
        },
    )
