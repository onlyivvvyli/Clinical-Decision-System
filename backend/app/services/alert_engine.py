from __future__ import annotations

from dataclasses import dataclass

from app.schemas.prescription import PrescriptionCheckRequest
from app.services.fhir_service import FHIRService
from app.services.kg_service import KGService
from app.services.mapping_service import MappingService
from app.services.openai_service import OpenAIService


@dataclass(frozen=True)
class DDIRuleConfig:
    strictness: str
    enabled: bool
    minimum_prr: float | None


@dataclass(frozen=True)
class DrugDiseaseRuleConfig:
    strictness: str
    contraindication_enabled: bool
    off_label_enabled: bool


class AlertEngine:
    def __init__(self):
        self.fhir_service = FHIRService()
        self.kg_service = KGService()
        self.mapping_service = MappingService()
        self.openai_service = OpenAIService()

    @staticmethod
    def _safe_int(value: str | int | None) -> int | str | None:
        if value in (None, ""):
            return None
        try:
            return int(str(value))
        except (TypeError, ValueError):
            return value

    def _resolve_active_medication_ingredients(self, current_medications: list[dict]) -> tuple[list[dict], list[dict]]:
        resolved = []
        unresolved = []
        for medication in current_medications:
            medication_code = medication.get("code")
            medication_name = medication.get("name", "")
            ingredients = self.mapping_service.resolve_medication_code_to_ingredients(
                medication_code,
                medication_name,
            )
            if not ingredients:
                unresolved.append({
                    "source_medication_name": medication_name or "Unknown medication",
                    "source_medication_code": medication_code or "",
                    "reason": "No ingredients resolved from mapping service.",
                })
                continue

            fallback_used = len(ingredients) == 1 and str(ingredients[0].get("rxcui", "")) == str(medication_code or "")
            if fallback_used:
                unresolved.append({
                    "source_medication_name": medication_name or "Unknown medication",
                    "source_medication_code": medication_code or "",
                    "reason": "Mapping not found; using original medication code as fallback.",
                })

            for ingredient in ingredients:
                resolved.append(
                    {
                        "source_medication_name": medication_name or "Unknown medication",
                        "source_medication_code": medication_code or "",
                        "ingredient_rxcui": str(ingredient.get("rxcui", "")),
                        "ingredient_name": ingredient.get("name", "Unknown ingredient"),
                    }
                )
        return resolved, unresolved

    @staticmethod
    def _resolve_ddi_rule_config(strictness: str) -> DDIRuleConfig:
        normalized = (strictness or "standard").strip().casefold()
        if normalized == "off":
            return DDIRuleConfig(strictness="off", enabled=False, minimum_prr=None)
        if normalized == "high_signal":
            return DDIRuleConfig(strictness="high_signal", enabled=True, minimum_prr=50.0)
        if normalized == "strict":
            return DDIRuleConfig(strictness="strict", enabled=True, minimum_prr=None)
        return DDIRuleConfig(strictness="standard", enabled=True, minimum_prr=20.0)

    @staticmethod
    def _resolve_drug_disease_rule_config(strictness: str) -> DrugDiseaseRuleConfig:
        normalized = (strictness or "full").strip().casefold()
        if normalized == "off":
            return DrugDiseaseRuleConfig(
                strictness="off",
                contraindication_enabled=False,
                off_label_enabled=False,
            )
        if normalized == "contraindication_only":
            return DrugDiseaseRuleConfig(
                strictness="contraindication_only",
                contraindication_enabled=True,
                off_label_enabled=False,
            )
        return DrugDiseaseRuleConfig(
            strictness="full",
            contraindication_enabled=True,
            off_label_enabled=True,
        )

    @staticmethod
    def _build_applied_rules(ddi_rules: DDIRuleConfig, drug_disease_rules: DrugDiseaseRuleConfig) -> dict:
        return {
            "ddi": {
                "strictness": ddi_rules.strictness,
                "enabled": ddi_rules.enabled,
                "minimum_prr": ddi_rules.minimum_prr,
            },
            "drug_disease": {
                "strictness": drug_disease_rules.strictness,
                "contraindication_enabled": drug_disease_rules.contraindication_enabled,
                "off_label_enabled": drug_disease_rules.off_label_enabled,
            },
        }

    @staticmethod
    def _format_relation_chip(relation_type: str) -> str:
        if relation_type == "contraindicated_for":
            return "Contraindicated_for"
        return "Off_label_use_for"

    @staticmethod
    def _build_drug_disease_banner(selected_scd_name: str, condition_name: str, relation_type: str) -> tuple[str, str]:
        if relation_type == "contraindicated_for":
            return (
                "Potential contraindication",
                f"{selected_scd_name} conflicts with this patient's active condition: {condition_name}.",
            )
        return (
            "Potential off-label use",
            f"{selected_scd_name} has an off-label use relationship with this patient's active condition: {condition_name}.",
        )

    async def _build_drug_disease_alert(
        self,
        *,
        relation_kind: str,
        selected_scd_name: str,
        ingredient_rxcui: str,
        ingredient_name: str,
        disease_match: dict,
        ai_explanation_style: str = "balanced",
    ) -> dict:
        relation_type = "contraindicated_for" if relation_kind == "CONTRAINDICATION" else "off_label_use_for"
        condition_name = disease_match.get("disease_name") or "Unknown condition"
        condition_snomed_id = disease_match.get("snomed_code") or ""
        mapped_drug_rxnorm_id = self._safe_int(ingredient_rxcui)
        banner_title, banner_message = self._build_drug_disease_banner(selected_scd_name, condition_name, relation_type)
        evidence_strength = (
            "Rule-based clinical restriction" if relation_type == "contraindicated_for" else "Knowledge graph reference"
        )
        evidence_source = "Knowledge graph active-condition match"
        prompt_payload = {
            "prescribed_drug_name": selected_scd_name,
            "mapped_drug_name": ingredient_name,
            "mapped_drug_rxnorm_id": mapped_drug_rxnorm_id,
            "ingredients": ingredient_name,
            "condition_name": condition_name,
            "condition_snomed_id": condition_snomed_id,
            "relation_type": relation_type,
            "evidence_source": evidence_source,
            "evidence_strength": evidence_strength,
            "ai_explanation_style": ai_explanation_style,
        }
        explanation = await self.openai_service.generate_drug_disease_alert_text(prompt_payload)

        return {
            "key": f"{relation_type}-{ingredient_rxcui}-{disease_match.get('disease_id') or condition_snomed_id or condition_name}",
            "type": relation_kind,
            "relation_type": relation_type,
            "sort_priority": 0 if relation_type == "contraindicated_for" else 1,
            "prescribed_drug_name": selected_scd_name,
            "new_drug_rxcui": mapped_drug_rxnorm_id,
            "new_drug_name": selected_scd_name,
            "mapped_drug_name": ingredient_name,
            "mapped_drug_rxnorm_id": mapped_drug_rxnorm_id,
            "disease_id": disease_match.get("disease_id"),
            "disease_name": condition_name,
            "condition_name": condition_name,
            "snomed_code": condition_snomed_id,
            "condition_snomed_id": condition_snomed_id,
            "banner_title": banner_title,
            "banner_message": banner_message,
            "explanation": explanation,
            "ai_disclaimer": "AI-generated explanation. Please use clinical judgment.",
            "evidence_source": evidence_source,
            "evidence_strength": evidence_strength,
            "knowledge_graph_relation": self._format_relation_chip(relation_type),
            "supporting_data": [
                {
                    "label": "Knowledge graph relation",
                    "value": self._format_relation_chip(relation_type),
                },
                {
                    "label": "Mapped drug",
                    "value": f"{ingredient_name} (RxCUI: {mapped_drug_rxnorm_id or 'N/A'})",
                },
                {
                    "label": "Mapped condition",
                    "value": f"{condition_name} (SNOMED: {condition_snomed_id or 'N/A'})",
                },
                {
                    "label": "Evidence strength",
                    "value": evidence_strength,
                },
            ],
            "message": banner_message,
        }

    async def run_medication_check(self, patient_id: str, new_medication: PrescriptionCheckRequest):
        selected_scd, resolved_ingredients = self.mapping_service.resolve_scd_to_ingredients(new_medication.scd_rxcui)
        if not selected_scd:
            raise RuntimeError(f"SCD RxCUI {new_medication.scd_rxcui} could not be resolved to ingredients.")

        selected_scd_name = selected_scd.get("name") or new_medication.scd_name or str(new_medication.scd_rxcui)

        combination_ingredient_names = []
        seen_combination_ingredients = set()
        for item in resolved_ingredients:
            ingredient_label = str(item.get("name") or "").strip()
            dedupe_key = ingredient_label.casefold()
            if ingredient_label and dedupe_key not in seen_combination_ingredients:
                seen_combination_ingredients.add(dedupe_key)
                combination_ingredient_names.append(ingredient_label)

        patient = await self.fhir_service.get_patient(patient_id)
        conditions = await self.fhir_service.get_patient_conditions(patient_id)
        active_conditions = [
            condition for condition in conditions if str(condition.get("clinical_status", "")).strip().casefold() == "active"
        ]
        medications = await self.fhir_service.get_patient_medications(patient_id)
        current_medications = medications["current"]
        active_ingredients, unresolved_active_medications = self._resolve_active_medication_ingredients(current_medications)
        ddi_rules = self._resolve_ddi_rule_config(new_medication.ddi_strictness)
        drug_disease_rules = self._resolve_drug_disease_rule_config(new_medication.drug_disease_strictness)

        ddi_alerts = []
        drug_disease_alerts = []
        drug_disease_references = []
        alerts = []
        seen_ddi = set()
        seen_contra = set()
        seen_offlabel = set()

        for ingredient in resolved_ingredients:
            ingredient_rxcui = str(ingredient.get("rxcui", ""))
            ingredient_name = ingredient.get("name", "Unknown ingredient")
            if not ingredient_rxcui:
                continue

            if ddi_rules.enabled:
                for active in active_ingredients:
                    active_rxcui = active.get("ingredient_rxcui", "")
                    if not active_rxcui:
                        continue
                    ddi_key = tuple(sorted([ingredient_rxcui, active_rxcui]))
                    if ddi_key in seen_ddi:
                        continue

                    evidence = self.kg_service.get_top_ddi_evidence(
                        ingredient_rxcui,
                        active_rxcui,
                        limit=5,
                        minimum_prr=ddi_rules.minimum_prr,
                    )
                    if not evidence:
                        continue

                    seen_ddi.add(ddi_key)
                    active_medication_name = active.get("source_medication_name", "Unknown medication")
                    active_ingredient_name = active.get("ingredient_name", active_medication_name)
                    prompt_payload = self.kg_service.build_ddi_prompt_payload(
                        drug_a_name=ingredient_name,
                        drug_b_name=active_ingredient_name,
                        evidence_items=evidence,
                        drug_name=selected_scd_name,
                        combination_ingredients=combination_ingredient_names,
                        trigger_ingredient=ingredient_name,
                        current_medication=active_medication_name,
                    )
                    prompt_payload["ai_explanation_style"] = new_medication.ai_explanation_style
                    explanation = await self.openai_service.generate_ddi_alert_text(prompt_payload)

                    ddi_alert = {
                        "type": "DDI",
                        "candidate_drug": {
                            "rxnorm_id": self._safe_int(ingredient_rxcui),
                            "name": ingredient_name,
                            "scd_name": selected_scd_name,
                            "ingredient_name": ingredient_name,
                        },
                        "active_drug": {
                            "rxnorm_id": self._safe_int(active_rxcui),
                            "name": active_ingredient_name,
                            "medication_name": active_medication_name,
                            "ingredient_name": active_ingredient_name,
                        },
                        "has_interaction": True,
                        "evidence": evidence,
                        "evidence_payload": prompt_payload,
                        "explanation": explanation,
                        "new_drug_rxcui": self._safe_int(ingredient_rxcui),
                        "new_drug_name": ingredient_name,
                        "new_drug_scd_name": selected_scd_name,
                        "new_drug_in_name": ingredient_name,
                        "active_drug_rxcui": self._safe_int(active_rxcui),
                        "active_drug_name": active_ingredient_name,
                        "active_medication_name": active_medication_name,
                        "active_drug_in_name": active_ingredient_name,
                        "message": explanation,
                    }
                    ddi_alerts.append(ddi_alert)
                    alerts.append(ddi_alert)

            if drug_disease_rules.contraindication_enabled or drug_disease_rules.off_label_enabled:
                disease_hits = self.kg_service.check_drug_disease(
                    ingredient_rxcui,
                    active_conditions,
                    include_contraindications=drug_disease_rules.contraindication_enabled,
                    include_off_label=drug_disease_rules.off_label_enabled,
                )

                for item in disease_hits["contraindications"]:
                    contra_key = (ingredient_rxcui, item.get("disease_id"), item.get("snomed_code"))
                    if contra_key in seen_contra:
                        continue
                    seen_contra.add(contra_key)
                    contra_alert = await self._build_drug_disease_alert(
                        relation_kind="CONTRAINDICATION",
                        selected_scd_name=selected_scd_name,
                        ingredient_rxcui=ingredient_rxcui,
                        ingredient_name=ingredient_name,
                        disease_match=item,
                        ai_explanation_style=new_medication.ai_explanation_style,
                    )
                    drug_disease_alerts.append(contra_alert)
                    alerts.append(contra_alert)

                for item in disease_hits["off_label"]:
                    offlabel_key = (ingredient_rxcui, item.get("disease_id"), item.get("snomed_code"))
                    if offlabel_key in seen_offlabel:
                        continue
                    seen_offlabel.add(offlabel_key)
                    reference = await self._build_drug_disease_alert(
                        relation_kind="OFF_LABEL_USE",
                        selected_scd_name=selected_scd_name,
                        ingredient_rxcui=ingredient_rxcui,
                        ingredient_name=ingredient_name,
                        disease_match=item,
                    )
                    drug_disease_references.append(reference)
                    alerts.append(reference)

        blocked = bool(ddi_alerts or drug_disease_alerts)
        if blocked:
            message = "Risk alerts detected at the ingredient level after SCD resolution."
        else:
            message = "No blocking alerts detected after SCD-to-ingredient resolution."

        return {
            "patient_id": patient_id,
            "patient": patient,
            "selected_scd": {
                "rxcui": selected_scd.get("rxcui"),
                "name": selected_scd_name,
            },
            "resolved_ingredients": resolved_ingredients,
            "active_medication_ingredients": active_ingredients,
            "unresolved_active_medications": unresolved_active_medications,
            "alerts": alerts,
            "decision": "blocked" if blocked else "approved",
            "can_prescribe": not blocked,
            "ddi_alerts": ddi_alerts,
            "drug_disease_alerts": drug_disease_alerts,
            "drug_disease_references": drug_disease_references,
            "appliedRules": self._build_applied_rules(ddi_rules, drug_disease_rules),
            "drug_disease_module": {
                "implemented": drug_disease_rules.contraindication_enabled or drug_disease_rules.off_label_enabled,
                "message": (
                    "Drug-disease checks skipped by rule configuration."
                    if not (drug_disease_rules.contraindication_enabled or drug_disease_rules.off_label_enabled)
                    else "Checks executed through SCD-to-ingredient mapping and SNOMED disease matching."
                ),
            },
            "message": message,
        }

    async def submit_prescription(self, doctor_id: int, patient_id: str, new_medication: PrescriptionCheckRequest):
        _ = doctor_id
        result = await self.run_medication_check(patient_id, new_medication)

        writeback = await self.fhir_service.create_medication_request(
            patient_id,
            {
                "medication_name": result["selected_scd"]["name"],
                "medication_code": str(result["selected_scd"]["rxcui"]),
                "dosage": new_medication.dosage,
                "frequency": new_medication.frequency,
                "reason": new_medication.reason,
            },
        )
        result["fhir_writeback"] = writeback
        result["decision"] = "approved"
        result["can_prescribe"] = True
        if result["ddi_alerts"] or result["drug_disease_alerts"]:
            result["message"] = "Prescription continued and written back to FHIR with documented safety alerts visible to the clinician."
        else:
            result["message"] = "Prescription approved and written back to FHIR after SCD-to-ingredient safety checks."
        return result
