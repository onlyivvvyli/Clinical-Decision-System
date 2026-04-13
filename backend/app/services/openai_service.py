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
        ingredients = str(payload.get("ingredients") or payload.get("mapped_drug_name") or "").strip()
        condition_name = str(payload.get("condition_name") or "").strip()
        relation_type = str(payload.get("relation_type") or "").strip()

        if not self.enabled:
            print(f"[drug-disease-explanation] source=fallback reason=openai_disabled drug={drug_name or 'N/A'} condition={condition_name or 'N/A'} relation={relation_type or 'N/A'}")
            return fallback_text

        if not drug_name or not ingredients or not condition_name or not relation_type:
            print(f"[drug-disease-explanation] source=fallback reason=missing_input drug={drug_name or 'N/A'} condition={condition_name or 'N/A'} relation={relation_type or 'N/A'}")
            return fallback_text

        system_prompt = (
            "You are helping generate concise clinical safety explanations for a prescribing alert interface.\n\n"
            "Your task is to write exactly ONE short sentence for clinicians explaining why a flagged drug-condition relationship may matter clinically.\n\n"
            "The alert has already been determined by the backend. You are not making the safety decision. You are only explaining it.\n\n"
            "When helpful, infer and use the following types of information:\n"
            "- the relevant active ingredient\n"
            "- the drug class\n"
            "- the pharmacologic mechanism or major physiologic effect\n"
            "- the likely condition-specific consequence\n\n"
            "Priority of explanation:\n"
            "1. mention the most clinically relevant ingredient, drug class, or mechanism\n"
            "2. connect it to a plausible consequence for the patient's active condition\n"
            "3. keep the explanation readable and concise\n\n"
            "Style requirements:\n"
            "- exactly one sentence\n"
            "- 18 to 32 words preferred\n"
            "- professional, clinical, readable\n"
            "- specific when possible, but conservative\n"
            "- prioritize likely mechanism over vague warnings\n\n"
            "Hard constraints:\n"
            "- do not restate that this is a contraindication or off-label relationship\n"
            "- do not mention the knowledge graph, database, alert engine, or backend\n"
            "- do not mention missing evidence, confidence scores, or source reliability\n"
            "- do not invent highly specific facts such as incidence rates, study outcomes, lab values, or guideline statements unless explicitly provided\n"
            "- do not claim certainty when the relationship is only suggestive; prefer wording like may, could, can, or should be considered\n"
            "- do not produce more than one sentence\n"
            "- do not use bullet points or lists\n\n"
            "Reasoning guidance:\n"
            "- If the drug name is a brand or combination product, use the most relevant active ingredient or main pharmacologic effect in the explanation.\n"
            "- If multiple ingredients are present, focus on the ingredient most relevant to the condition-specific concern.\n"
            "- If a well-known drug class is clinically clearer than the ingredient name alone, include the class.\n"
            "- If a known mechanism is more useful than the class name, include the mechanism.\n"
            "- The consequence should be tailored to the condition, not generic. For example:\n"
            "  - hypertension -> raise blood pressure, worsen blood pressure control, increase cardiovascular strain\n"
            "  - peptic ulcer disease -> gastrointestinal irritation, bleeding risk, ulcer worsening\n"
            "  - asthma -> bronchospasm risk, airway reactivity\n"
            "  - chronic kidney disease -> reduced renal perfusion, nephrotoxicity risk, worsening kidney function\n"
            "  - diabetes -> altered glycemic control\n"
            "  - seizure disorder -> lower seizure threshold\n"
            "- For off-label use, the tone should be lower urgency than for contraindication. It may mention non-standard indication, variable benefit, monitoring needs, or context-dependent appropriateness, but still tie to the condition.\n\n"
            "Output requirements:\n"
            "Return only the final sentence and nothing else."
        )

        user_prompt = (
            f"Drug name: {drug_name}\n"
            f"Ingredients: {ingredients}\n"
            f"Relationship type: {relation_type}\n"
            f"Condition: {condition_name}\n\n"
            "Examples:\n\n"
            "Example 1\n"
            "Drug name: Pseudoephedrine 60 mg tablet\n"
            "Ingredients: Pseudoephedrine\n"
            "Relationship type: contraindicated_for\n"
            "Condition: Hypertensive disorder\n"
            "Output:\n"
            "Its sympathomimetic decongestant effect may raise blood pressure and could worsen hypertension or increase cardiovascular strain.\n\n"
            "Example 2\n"
            "Drug name: Ibuprofen\n"
            "Ingredients: Ibuprofen\n"
            "Relationship type: contraindicated_for\n"
            "Condition: Peptic ulcer disease\n"
            "Output:\n"
            "As an NSAID, it may increase gastrointestinal irritation and bleeding risk, which could worsen ulcer disease or lead to related complications.\n\n"
            "Example 3\n"
            "Drug name: Propranolol\n"
            "Ingredients: Propranolol\n"
            "Relationship type: contraindicated_for\n"
            "Condition: Asthma\n"
            "Output:\n"
            "Its nonselective beta-blocking effect may provoke bronchospasm and could worsen airway reactivity in patients with asthma.\n\n"
            "Example 4\n"
            "Drug name: Lisinopril\n"
            "Ingredients: Lisinopril\n"
            "Relationship type: contraindicated_for\n"
            "Condition: Chronic kidney disease\n"
            "Output:\n"
            "Its effects on renal hemodynamics may reduce kidney perfusion in susceptible patients and could worsen underlying renal impairment.\n\n"
            "Example 5\n"
            "Drug name: Gabapentin\n"
            "Ingredients: Gabapentin\n"
            "Relationship type: off_label_use_for\n"
            "Condition: Chronic cough\n"
            "Output:\n"
            "Its neuromodulatory effect may help symptom control in some contexts, but variable benefit and sedation should be considered for this condition.\n\n"
            "Now write the explanation sentence for the current input."
        )

        request_body = {
            "model": self.settings.openai_model,
            "instructions": system_prompt,
            "input": user_prompt,
            "max_output_tokens": 80,
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
