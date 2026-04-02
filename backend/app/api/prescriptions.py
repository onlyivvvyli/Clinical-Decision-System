from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db.models import PrescriptionLog
from app.db.session import get_db
from app.schemas.prescription import DDIExplanationRequest, PrescriptionCheckRequest, PrescriptionSubmitRequest
from app.services.alert_engine import AlertEngine
from app.services.fhir_service import FHIRServiceError

router = APIRouter()
alert_engine = AlertEngine()
openai_service = alert_engine.openai_service


@router.post("/prescriptions/check")
async def check_prescription(payload: PrescriptionCheckRequest):
    try:
        return await alert_engine.run_medication_check(
            patient_id=payload.patient_id,
            new_medication=payload,
        )
    except (FHIRServiceError, RuntimeError, FileNotFoundError) as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post("/prescriptions/submit")
async def submit_prescription(payload: PrescriptionSubmitRequest, db: Session = Depends(get_db)):
    try:
        result = await alert_engine.submit_prescription(
            doctor_id=payload.doctor_id,
            patient_id=payload.patient_id,
            new_medication=payload,
        )
    except (FHIRServiceError, RuntimeError, FileNotFoundError) as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    log_entry = PrescriptionLog(
        doctor_id=payload.doctor_id,
        patient_id=payload.patient_id,
        medication_name=result["selected_scd"]["name"],
        medication_code=str(result["selected_scd"]["rxcui"]),
        decision=result["decision"],
        alert_summary=result["message"],
    )
    db.add(log_entry)
    db.commit()

    return result


@router.post("/prescriptions/explain-ddi")
async def explain_ddi(payload: DDIExplanationRequest):
    try:
        return {
            "message": await openai_service.generate_ddi_alert_text(payload.prompt_payload),
        }
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
