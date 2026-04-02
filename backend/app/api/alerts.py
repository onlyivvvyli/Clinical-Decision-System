from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db.models import PrescriptionLog
from app.db.session import get_db
from app.schemas.alert import AlertLogItem

router = APIRouter()


@router.get("/alerts", response_model=list[AlertLogItem])
def list_alerts(db: Session = Depends(get_db)):
    logs = (
        db.query(PrescriptionLog)
        .order_by(PrescriptionLog.created_at.desc())
        .limit(20)
        .all()
    )
    return logs
