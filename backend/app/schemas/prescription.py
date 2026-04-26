from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


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
    ai_explanation_style: str = Field(default="balanced", alias="aiExplanationStyle")


class PrescriptionSubmitRequest(PrescriptionCheckRequest):
    doctor_id: int = Field(alias="doctorId")


class DDIExplanationRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    prompt_payload: dict = Field(alias="promptPayload")
