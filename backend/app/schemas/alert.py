from datetime import datetime

from pydantic import BaseModel


class AppliedDDIRules(BaseModel):
    strictness: str
    enabled: bool
    minimum_prr: float | None = None


class AppliedDrugDiseaseRules(BaseModel):
    strictness: str
    contraindication_enabled: bool
    off_label_enabled: bool


class AppliedAlertRules(BaseModel):
    ddi: AppliedDDIRules
    drug_disease: AppliedDrugDiseaseRules


class DDIEvidence(BaseModel):
    source: str | None = None
    prr: float | None = None
    mean_reporting_frequency: float | None = None


class DDIAlertItem(BaseModel):
    severity: str
    drug_1: str
    drug_2: str
    effect: str
    evidence: DDIEvidence


class DrugDiseaseModuleStatus(BaseModel):
    implemented: bool
    message: str


class FHIRWritebackResponse(BaseModel):
    status: str
    resource_type: str
    resource_id: str | None = None


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
