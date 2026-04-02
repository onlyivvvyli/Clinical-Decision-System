from pydantic import BaseModel


class PatientListItem(BaseModel):
    id: str
    name: str
    gender: str
    birth_date: str
    age: str


class ConditionItem(BaseModel):
    name: str
    code: str
    clinical_status: str
    onset_date: str | None = None


class MedicationItem(BaseModel):
    id: str | None = None
    name: str
    code: str
    status: str
    authored_on: str | None = None
    dosage_text: str | None = None
    period: str | None = None


class PatientDetailResponse(BaseModel):
    patient: PatientListItem
    current_conditions: list[ConditionItem]
    current_medications: list[MedicationItem]
    medication_history: list[MedicationItem]
