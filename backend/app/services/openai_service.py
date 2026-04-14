from __future__ import annotations

import httpx

from app.core.config import get_settings


class OpenAIService:
    _client: httpx.AsyncClient | None = None

    def __init__(self):
        self.settings = get_settings()

    @classmethod
    def _get_client(cls, timeout_seconds: float) -> httpx.AsyncClient:
        if cls._client is None:
            cls._client = httpx.AsyncClient(
                timeout=timeout_seconds,
                limits=httpx.Limits(max_keepalive_connections=10, max_connections=20),
            )
        return cls._client

    @property
    def enabled(self) -> bool:
        return bool(self.settings.openai_api_key.strip())

    @staticmethod
    def _extract_output_text(payload: dict) -> str:
        output_text = str(payload.get("output_text") or "").strip()
        if output_text:
            return output_text

        chunks = []
        for item in payload.get("output") or []:
            if item.get("type") != "message":
                continue
            for content in item.get("content") or []:
                if content.get("type") == "output_text" and content.get("text"):
                    chunks.append(str(content.get("text")))
        return "\n".join(chunk.strip() for chunk in chunks if chunk.strip()).strip()

    @staticmethod
    def _join_ingredients(items: list[str]) -> str:
        cleaned = [str(item).strip() for item in items if str(item).strip()]
        if not cleaned:
            return ""
        if len(cleaned) == 1:
            return cleaned[0]
        if len(cleaned) == 2:
            return f"{cleaned[0]} and {cleaned[1]}"
        return f"{', '.join(cleaned[:-1])}, and {cleaned[-1]}"

    @classmethod
    def render_ddi_alert_text(cls, payload: dict) -> str:
        drug_name = payload.get("drug_name") or payload.get("trigger_ingredient") or payload.get("drug_a") or "Drug A"
        trigger_ingredient = payload.get("trigger_ingredient") or payload.get("drug_a") or drug_name
        current_medication = payload.get("current_medication") or payload.get("drug_b") or "Drug B"
        combination_ingredients = [
            str(item).strip() for item in payload.get("combination_ingredients") or [] if str(item).strip()
        ]
        top_conditions = payload.get("top_conditions") or []

        lines = []
        if len(combination_ingredients) > 1:
            lines.append(f"The drug contains {cls._join_ingredients(combination_ingredients)}.")
            lines.append(f"{trigger_ingredient} and {current_medication} have reported interaction signals.")
        else:
            lines.append(f"{drug_name} and {current_medication} have reported interaction signals.")

        if top_conditions:
            lines.append("")
            lines.append("Top conditions include:")
            for item in top_conditions:
                if item.get("display_text"):
                    lines.append(f"- {item['display_text']}")

        return "\n".join(lines).strip()

    @classmethod
    def render_drug_disease_alert_text(cls, payload: dict) -> str:
        ingredients = str(payload.get("ingredients") or payload.get("mapped_drug_name") or payload.get("prescribed_drug_name") or "the medication").strip()
        condition_name = str(payload.get("condition_name") or "the active condition").strip()
        relation_type = str(payload.get("relation_type") or "").strip().casefold()

        if relation_type == "contraindicated_for":
            return f"Its pharmacologic effects may aggravate {condition_name} and increase the risk of clinically significant worsening in this patient."
        return f"Its pharmacologic profile may affect symptom control in {condition_name}, with benefits and tolerability needing review in the current clinical context."

    async def generate_ddi_alert_text(self, payload: dict) -> str:
        fallback_text = self.render_ddi_alert_text(payload)
        if not self.enabled:
            print(f"[drug-disease-explanation] source=fallback reason=openai_disabled drug={drug_name or 'N/A'} condition={condition_name or 'N/A'} relation={relation_type or 'N/A'}")
            return fallback_text

        drug_name = payload.get("drug_name") or payload.get("trigger_ingredient") or payload.get("drug_a")
        trigger_ingredient = payload.get("trigger_ingredient") or payload.get("drug_a")
        current_medication = payload.get("current_medication") or payload.get("drug_b")
        combination_ingredients = [
            str(item).strip() for item in payload.get("combination_ingredients") or [] if str(item).strip()
        ]
        top_conditions = payload.get("top_conditions") or []
        display_lines = [item.get("display_text") for item in top_conditions if item.get("display_text")]
        if not drug_name or not current_medication or not trigger_ingredient or not display_lines:
            return fallback_text

        instructions = (
            "You are writing a concise clinician-facing DDI explanation. "
            "Follow the output template exactly. "
            "If the newly prescribed drug is a combination drug, first list all contained ingredients in the first sentence. "
            "Then identify which ingredient actually matched the DDI signal, and use only that ingredient in the second sentence. "
            "Do not say the whole combination drug interacted if only one ingredient triggered the match. "
            "If there is only one ingredient, omit the first sentence and directly state '{drug_name} and {current_medication} have reported interaction signals.' "
            "Show only the top conditions ranked by PRR descending. "
            "Use the provided readable PRR multiplier and frequency label exactly as given. "
            "Keep the output factual, concise, and non-deterministic. "
            "Return plain text only, with no markdown fence and no extra commentary."
        )

        input_lines = [
            f"Drug name: {drug_name}",
            f"Combination ingredients: {', '.join(combination_ingredients) if combination_ingredients else '(single ingredient drug)'}",
            f"Trigger ingredient: {trigger_ingredient}",
            f"Current medication: {current_medication}",
            "Top conditions ranked by PRR descending:",
        ]
        input_lines.extend(display_lines)
        input_lines.extend(
            [
                "",
                "Required template:",
                "The drug contains {ingredient_1} and {ingredient_2}[, ...].",
                "{trigger_ingredient} and {current_medication} have reported interaction signals.",
                "",
                "Top conditions include:",
                "- {condition_1} (~{multiplier_1}x more frequently reported than expected; {frequency_label_1} overall)",
                "- {condition_2} (~{multiplier_2}x more frequently reported than expected; {frequency_label_2} overall)",
                "- {condition_3} (~{multiplier_3}x more frequently reported than expected; {frequency_label_3} overall)",
                "- ...",
                "",
                "Rules:",
                "1. If the newly prescribed drug is a combination drug, first list all contained ingredients in the first sentence.",
                "2. Identify which ingredient actually matched the DDI signal, and use that ingredient in the second sentence.",
                "3. Do not say the whole combination drug interacted if only one ingredient triggered the match.",
                "4. Show only the top conditions ranked by PRR descending.",
                "5. The phrase '{multiplier}x more frequently reported than expected' comes from PRR, rounded to a readable number.",
                "6. The phrase '{frequency_label} overall' comes from mean_reporting_frequency and has already been converted into a human-readable bucket.",
                "7. If there is only one ingredient, omit the first sentence and directly state '{drug_name} and {current_medication} have reported interaction signals.'",
                "8. Keep the tone concise and clinician-facing.",
            ]
        )

        request_body = {
            "model": self.settings.openai_model,
            "instructions": instructions,
            "input": "\n".join(input_lines),
            "max_output_tokens": 220,
        }

        headers = {
            "Authorization": f"Bearer {self.settings.openai_api_key}",
            "Content-Type": "application/json",
        }
        url = f"{self.settings.openai_base_url.rstrip('/')}/responses"

        try:
            client = self._get_client(self.settings.openai_timeout_seconds)
            response = await client.post(url, headers=headers, json=request_body)
            response.raise_for_status()
            generated_text = self._extract_output_text(response.json())
        except httpx.HTTPError as exc:
            response_text = getattr(getattr(exc, "response", None), "text", "")
            print(f"[drug-disease-explanation] source=fallback reason=http_error drug={drug_name or 'N/A'} condition={condition_name or 'N/A'} relation={relation_type or 'N/A'} error={exc} response={response_text}")
            return fallback_text

        final_text = generated_text or fallback_text
        source = "openai" if generated_text else "fallback"
        reason = "generated" if generated_text else "empty_response"
        print(f"[drug-disease-explanation] source={source} reason={reason} drug={drug_name or 'N/A'} condition={condition_name or 'N/A'} relation={relation_type or 'N/A'} text={final_text}")
        return final_text

    async def generate_drug_disease_alert_text(self, payload: dict) -> str:
        fallback_text = self.render_drug_disease_alert_text(payload)
        drug_name = str(payload.get("prescribed_drug_name") or "").strip()
        mapped_drug_name = str(payload.get("mapped_drug_name") or payload.get("ingredients") or "").strip()
        drug_rxcui = str(payload.get("mapped_drug_rxnorm_id") or "").strip()
        condition_name = str(payload.get("condition_name") or "").strip()
        condition_snomed = str(payload.get("condition_snomed_id") or "").strip()
        relation_type = str(payload.get("relation_type") or "").strip()
        evidence_label = str(payload.get("evidence_strength") or payload.get("evidence_source") or "").strip()
        alert_type = "Contraindication" if relation_type == "contraindicated_for" else "Off-label use"

        if not self.enabled:
            print(f"[drug-disease-explanation] source=fallback reason=openai_disabled drug={drug_name or 'N/A'} condition={condition_name or 'N/A'} relation={relation_type or 'N/A'}")
            return fallback_text

        if not drug_name or not mapped_drug_name or not condition_name or not relation_type:
            print(f"[drug-disease-explanation] source=fallback reason=missing_input drug={drug_name or 'N/A'} condition={condition_name or 'N/A'} relation={relation_type or 'N/A'}")
            return fallback_text

        system_prompt = (
            "You are generating a concise clinician-facing explanation for a drug-disease prescribing alert.\n\n"
            "Your job is to explain the alert based on the structured evidence provided.\n\n"
            "Important rules:\n"
            "- Use only the evidence provided in the input.\n"
            "- You may add a cautious, high-level clinical interpretation if it is broadly consistent with well-known general clinical knowledge.\n"
            "- Do not invent specific molecular, pharmacokinetic, or pharmacodynamic mechanisms unless they are explicitly provided.\n"
            "- Do not introduce new evidence, statistics, guidelines, or claims not supported by the input.\n"
            "- Do not overstate certainty.\n"
            "- Use cautious wording such as 'may', 'could', 'possible concern', 'may warrant caution', or 'may warrant review'.\n"
            "- If the relation is Contraindicated_for, explain it as a contraindication alert and emphasize caution.\n"
            "- If the relation is Off_label_use_for, explain it as an off-label use alert and clarify that off-label use does not necessarily mean inappropriate use.\n"
            "- Keep the explanation concise, natural, and appropriate for a clinician-facing UI.\n"
            "- Output only the explanation text.\n"
            "- Write 2 to 4 sentences."
        )

        user_prompt = (
            "Generate a short 'Why this was flagged' explanation for a drug-disease alert.\n\n"
            "Structured evidence:\n"
            f"- Alert type: {alert_type}\n"
            f"- Prescribing drug: {drug_name}\n"
            f"- Mapped drug: {mapped_drug_name}\n"
            f"- Drug RxCUI: {drug_rxcui or 'N/A'}\n"
            f"- Active condition: {condition_name}\n"
            f"- Condition SNOMED: {condition_snomed or 'N/A'}\n"
            f"- Knowledge graph relation: {relation_type}\n"
            f"- Evidence strength/source: {evidence_label or 'N/A'}\n\n"
            "Requirements:\n"
            "- Base the explanation only on the structured evidence above.\n"
            "- Use cautious clinician-friendly language.\n"
            "- Do not claim a confirmed mechanism unless explicitly supported by the input.\n"
            "- Do not use bullet points.\n"
            "- Do not include headings.\n"
            "- Do not include disclaimer text."
        )

        request_body = {
            "model": self.settings.openai_model,
            "instructions": system_prompt,
            "input": user_prompt,
            "max_output_tokens": 140,
        }

        headers = {
            "Authorization": f"Bearer {self.settings.openai_api_key}",
            "Content-Type": "application/json",
        }
        url = f"{self.settings.openai_base_url.rstrip('/')}/responses"

        try:
            client = self._get_client(self.settings.openai_timeout_seconds)
            response = await client.post(url, headers=headers, json=request_body)
            response.raise_for_status()
            generated_text = self._extract_output_text(response.json())
        except httpx.HTTPError as exc:
            response_text = getattr(getattr(exc, "response", None), "text", "")
            print(f"[drug-disease-explanation] source=fallback reason=http_error drug={drug_name or 'N/A'} condition={condition_name or 'N/A'} relation={relation_type or 'N/A'} error={exc} response={response_text}")
            return fallback_text

        final_text = generated_text or fallback_text
        source = "openai" if generated_text else "fallback"
        reason = "generated" if generated_text else "empty_response"
        print(f"[drug-disease-explanation] source={source} reason={reason} drug={drug_name or 'N/A'} condition={condition_name or 'N/A'} relation={relation_type or 'N/A'} text={final_text}")
        return final_text
