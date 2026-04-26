from datetime import datetime

from pydantic import BaseModel


class AlertLogItem(BaseModel):
    id: int
    doctor_id: int
    patient_id: str
    medication_name: str
    medication_code: str
    decision: str
    alert_summary: str
    created_at: datetime

    class Config:
        from_attributes = True
