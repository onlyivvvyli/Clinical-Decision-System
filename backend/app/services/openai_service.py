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

    async def generate_ddi_alert_text(self, payload: dict) -> str:
        fallback_text = self.render_ddi_alert_text(payload)
        if not self.enabled:
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
        except httpx.HTTPError:
            return fallback_text

        return generated_text or fallback_text
