from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.alert import AppliedAlertRules, DrugDiseaseModuleStatus, FHIRWritebackResponse


class PrescriptionCheckRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    patient_id: str = Field(alias="patientId")
    scd_rxcui: int = Field(alias="scdRxcui")
    scd_name: str | None = Field(default=None, alias="scdName")
    dosage: str = ""
    frequency: str = ""
    reason: str | None = None
    ddi_strictness: Literal["off", "high_signal", "standard", "strict"] = Field(
        default="standard",
        alias="ddiStrictness",
    )
    drug_disease_strictness: Literal["off", "contraindication_only", "full"] = Field(
        default="full",
        alias="drugDiseaseStrictness",
    )


class PrescriptionSubmitRequest(PrescriptionCheckRequest):
    doctor_id: int = Field(alias="doctorId")


class DDIExplanationRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    prompt_payload: dict = Field(alias="promptPayload")


class DDIExplanationResponse(BaseModel):
    message: str


class PrescriptionDecisionResponse(BaseModel):
    patient_id: str
    selected_scd: dict
    resolved_ingredients: list[dict]
    alerts: list[dict]
    decision: str
    can_prescribe: bool
    ddi_alerts: list[dict]
    drug_disease_alerts: list[dict]
    drug_disease_references: list[dict] = []
    drug_disease_module: DrugDiseaseModuleStatus
    applied_rules: AppliedAlertRules = Field(alias="appliedRules")
    fhir_writeback: FHIRWritebackResponse | None = None
    message: str
