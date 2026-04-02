import asyncio

from fastapi import APIRouter, HTTPException

from app.schemas.patient import PatientDetailResponse, PatientListItem
from app.services.fhir_service import FHIRService

router = APIRouter()
fhir_service = FHIRService()


@router.get("/patients", response_model=list[PatientListItem])
async def list_patients():
    return await fhir_service.get_patients()


@router.get("/patients/{patient_id}", response_model=PatientListItem)
async def get_patient(patient_id: str):
    patient = await fhir_service.get_patient(patient_id)
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found.")
    return patient


@router.get("/patients/{patient_id}/summary", response_model=PatientDetailResponse)
async def get_patient_summary(patient_id: str):
    patient = await fhir_service.get_patient(patient_id)
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found.")

    conditions, medications = await asyncio.gather(
        fhir_service.get_patient_conditions(patient_id),
        fhir_service.get_patient_medications(patient_id),
    )

    return PatientDetailResponse(
        patient=patient,
        current_conditions=conditions,
        current_medications=medications["current"],
        medication_history=medications["history"],
    )
