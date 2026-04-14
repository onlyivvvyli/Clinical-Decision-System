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
    def _normalize_explanation_style(value: str | None) -> str:
        normalized = str(value or "balanced").strip().casefold()
        if normalized in {"conservative", "balanced", "exploratory"}:
            return normalized
        return "balanced"

    @classmethod
    def _explanation_style_config(cls, value: str | None) -> tuple[str, float]:
        style = cls._normalize_explanation_style(value)
        if style == "conservative":
            return (
                "AI explanation style: Conservative. Stay tightly evidence-grounded, prefer deterministic phrasing, and avoid broader mechanistic extrapolation unless it is very well established.",
                0.1,
            )
        if style == "exploratory":
            return (
                "AI explanation style: Exploratory. You may use slightly broader but still clinically reasonable mechanistic interpretation when it helps connect the signal pattern.",
                0.7,
            )
        return (
            "AI explanation style: Balanced. Keep explanations evidence-grounded while allowing moderate, well-established clinical reasoning when useful.",
            0.3,
        )

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
        drug_name = str(payload.get("drug_name") or payload.get("trigger_ingredient") or payload.get("drug_a") or "").strip()
        trigger_ingredient = str(payload.get("trigger_ingredient") or payload.get("drug_a") or "").strip()
        current_medication = str(payload.get("current_medication") or payload.get("drug_b") or "").strip()
        top_conditions = payload.get("top_conditions") or []
        style_instruction, temperature = self._explanation_style_config(payload.get("ai_explanation_style"))

        if not self.enabled:
            print(f"[ddi-explanation] source=fallback reason=openai_disabled drug_a={drug_name or 'N/A'} drug_b={current_medication or 'N/A'}")
            return fallback_text

        if not drug_name or not current_medication or not trigger_ingredient or len(top_conditions) < 3:
            print(f"[ddi-explanation] source=fallback reason=missing_input drug_a={drug_name or 'N/A'} drug_b={current_medication or 'N/A'} top_conditions={len(top_conditions)}")
            return fallback_text

        instructions = """You are a clinical pharmacology explanation assistant for prescribing safety alerts.

Your task is to generate a short "Why this was flagged" explanation for a drug-drug interaction alert.

Use the provided evidence as the primary grounding source.

You may use well-established pharmacologic knowledge based on the drug names and ingredients to provide lightweight mechanistic reasoning when relevant.

Rules:
1. Every bullet MUST explicitly include the quantitative signal using wording like:
   "~80\u00D7 more frequently than expected"
   "~7\u00D7 more frequently than expected"
2. Do NOT mention PRR explicitly.
3. Do NOT make definitive causal claims.
4. Use cautious reasoning such as:
   - may suggest
   - may indicate
   - possibly reflecting
   - may be associated with
5. Keep the output concise and clinician-friendly.
6. Output exactly:
   - 3 bullet points
   - 1 short overall summary sentence
7. The summary sentence should synthesize the overall mechanistic concern suggested by the signal pattern.
8. Do not invent unsupported evidence beyond standard pharmacology knowledge.
9. Do not omit the quantitative multipliers.
10. Use one sentence per bullet.
11. Follow this style guidance exactly: {style_instruction}"""

        instructions = instructions.replace("{style_instruction}", style_instruction)

        top_three = top_conditions[:3]

        input_text = """Generate a short "Why this was flagged" explanation.

Each bullet MUST explicitly include the quantitative multiplier, such as "~80\u00D7 more frequently than expected".

Example 1

Input:
Drug A: Warfarin sodium
Drug B: Aspirin oral tablet

Top reported signals:
1. Gastrointestinal haemorrhage, 7
2. Haemorrhage, 6
3. Anaemia, 5

Output:
- Gastrointestinal haemorrhage was reported ~7\u00D7 more frequently than expected, which may reflect increased bleeding risk when anticoagulant and antiplatelet effects overlap.
- Haemorrhage was also reported ~6\u00D7 more frequently than expected, consistent with a broader bleeding-related signal pattern.
- Anaemia was reported ~5\u00D7 more frequently than expected, possibly reflecting downstream consequences of clinically significant bleeding.
Overall, the main mechanistic concern is additive bleeding risk driven by impaired coagulation and platelet function.

Example 2

Input:
Drug A: Simvastatin oral tablet
Drug B: Gemfibrozil oral tablet

Top reported signals:
1. Myopathy, 18
2. Rhabdomyolysis, 16
3. Muscle weakness, 11

Output:
- Myopathy was reported ~18\u00D7 more frequently than expected, which may suggest a clinically meaningful muscle toxicity signal for this combination.
- Rhabdomyolysis was reported ~16\u00D7 more frequently than expected, possibly reflecting more severe muscle injury in susceptible patients.
- Muscle weakness was reported ~11\u00D7 more frequently than expected, reinforcing a broader pattern of muscle-related adverse effects.
Overall, the main mechanistic concern is increased statin-associated muscle injury.

Example 3

Input:
Drug A: Prednisone oral tablet
Drug B: Levofloxacin oral tablet

Top reported signals:
1. Tendon rupture, 12
2. Tendinitis, 10
3. Arthralgia, 6

Output:
- Tendon rupture was reported ~12\u00D7 more frequently than expected, which may suggest a meaningful tendon injury signal.
- Tendinitis was reported ~10\u00D7 more frequently than expected, consistent with increased tendon-related adverse event reporting.
- Arthralgia was reported ~6\u00D7 more frequently than expected, possibly reflecting associated musculoskeletal stress.
Overall, the main mechanistic concern is tendon toxicity due to overlapping connective tissue vulnerability.

Now generate the output for this case.

Input:
Drug A: {{drugA}}
Drug B: {{drugB}}

Top reported signals:
1. {{condition1}}, {{times1}}
2. {{condition2}}, {{times2}}
3. {{condition3}}, {{times3}}"""

        input_text = (
            input_text
            .replace("{{drugA}}", drug_name)
            .replace("{{drugB}}", current_medication)
            .replace("{{condition1}}", str(top_three[0].get("condition_name") or "Unknown condition"))
            .replace("{{times1}}", str(top_three[0].get("prr_text") or "N/A").replace("x", ""))
            .replace("{{condition2}}", str(top_three[1].get("condition_name") or "Unknown condition"))
            .replace("{{times2}}", str(top_three[1].get("prr_text") or "N/A").replace("x", ""))
            .replace("{{condition3}}", str(top_three[2].get("condition_name") or "Unknown condition"))
            .replace("{{times3}}", str(top_three[2].get("prr_text") or "N/A").replace("x", ""))
        )

        request_body = {
            "model": self.settings.openai_model,
            "instructions": instructions,
            "input": input_text,
            "max_output_tokens": 220,
            "temperature": temperature,
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
            print(f"[ddi-explanation] source=fallback reason=http_error drug_a={drug_name or 'N/A'} drug_b={current_medication or 'N/A'} error={exc} response={response_text}")
            return fallback_text

        final_text = generated_text or fallback_text
        source = "openai" if generated_text else "fallback"
        reason = "generated" if generated_text else "empty_response"
        print(f"[ddi-explanation] source={source} reason={reason} drug_a={drug_name or 'N/A'} drug_b={current_medication or 'N/A'} text={final_text}")
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
        style_instruction, temperature = self._explanation_style_config(payload.get("ai_explanation_style"))

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
            "- Write 2 to 4 sentences.\n"
            f"- {style_instruction}"
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
            "temperature": temperature,
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
