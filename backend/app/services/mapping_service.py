from __future__ import annotations

import json
import re
from functools import lru_cache
from threading import Lock
from typing import Any

import httpx

from app.core.config import get_settings


class MappingService:
    RXNORM_BASE_URL = "https://rxnav.nlm.nih.gov/REST"
    _mapping_write_lock = Lock()

    def __init__(self):
        self.settings = get_settings()

    @staticmethod
    def _normalize_name(value: str) -> str:
        normalized = value.lower().strip()
        normalized = re.sub(r"\s+", " ", normalized)
        return normalized

    @lru_cache(maxsize=1)
    def _load_mapping(self) -> list[dict[str, Any]]:
        path = self.settings.resolved_mapping_json_path
        if not path.exists():
            raise FileNotFoundError(f"Mapping JSON not found: {path}")
        return json.loads(path.read_text(encoding="utf-8"))

    def _save_mapping(self, entries: list[dict[str, Any]]) -> None:
        path = self.settings.resolved_mapping_json_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(entries, indent=2, ensure_ascii=True) + "\n", encoding="utf-8")
        self._load_mapping.cache_clear()

    def _fetch_rxnorm_name(self, rxcui: str) -> str:
        response = httpx.get(f"{self.RXNORM_BASE_URL}/rxcui/{rxcui}.json", timeout=15.0)
        response.raise_for_status()
        return str((response.json() or {}).get("idGroup", {}).get("name") or "").strip()

    def _fetch_rxnorm_ingredients(self, rxcui: str) -> list[dict[str, Any]]:
        response = httpx.get(
            f"{self.RXNORM_BASE_URL}/rxcui/{rxcui}/related.json",
            params={"tty": "IN PIN MIN"},
            timeout=15.0,
        )
        response.raise_for_status()

        related_group = (response.json() or {}).get("relatedGroup") or {}
        concept_groups = related_group.get("conceptGroup") or []
        ingredients = []
        seen_rxcui = set()

        for group in concept_groups:
            for concept in group.get("conceptProperties") or []:
                ingredient_rxcui = str(concept.get("rxcui") or "").strip()
                if not ingredient_rxcui or ingredient_rxcui in seen_rxcui:
                    continue
                seen_rxcui.add(ingredient_rxcui)
                ingredients.append(
                    {
                        "rxcui": int(ingredient_rxcui) if ingredient_rxcui.isdigit() else ingredient_rxcui,
                        "name": concept.get("name") or concept.get("synonym") or ingredient_rxcui,
                    }
                )

        return ingredients

    def _fetch_and_store_scd_mapping(self, scd_rxcui: str | int) -> dict[str, Any] | None:
        target = str(scd_rxcui).strip()
        if not target:
            return None

        with self._mapping_write_lock:
            existing = self.resolve_scd(target)
            if existing:
                return existing

            try:
                ingredients = self._fetch_rxnorm_ingredients(target)
                if not ingredients:
                    return None
                scd_name = self._fetch_rxnorm_name(target) or target
            except httpx.HTTPError:
                return None

            entries = self._load_mapping()
            entry = {
                "scd": {
                    "rxcui": int(target) if target.isdigit() else target,
                    "name": scd_name,
                },
                "ingredients": ingredients,
            }
            entries.append(entry)
            self._save_mapping(entries)
            return entry

    def search_scds(self, query: str = "", limit: int = 10) -> list[dict[str, Any]]:
        entries = self._load_mapping()
        normalized = query.strip().lower()
        matches = []
        for entry in entries:
            scd = entry.get("scd", {})
            name = str(scd.get("name", ""))
            if normalized and normalized not in name.lower():
                continue
            matches.append({
                "rxcui": scd.get("rxcui"),
                "name": name,
                "ingredient_count": len(entry.get("ingredients") or []),
            })
            if len(matches) >= limit:
                break
        return matches

    def resolve_scd(self, scd_rxcui: int | str) -> dict[str, Any] | None:
        target = str(scd_rxcui).strip()
        for entry in self._load_mapping():
            scd = entry.get("scd", {})
            if str(scd.get("rxcui", "")).strip() == target:
                return entry
        return None

    def resolve_scd_by_name(self, scd_name: str) -> dict[str, Any] | None:
        target = self._normalize_name(scd_name)
        if not target:
            return None
        for entry in self._load_mapping():
            scd = entry.get("scd", {})
            if self._normalize_name(str(scd.get("name", ""))) == target:
                return entry
        return None

    def resolve_scd_to_ingredients(self, scd_rxcui: int | str) -> tuple[dict[str, Any] | None, list[dict[str, Any]]]:
        entry = self.resolve_scd(scd_rxcui)
        if not entry:
            entry = self._fetch_and_store_scd_mapping(scd_rxcui)
        if not entry:
            return None, []
        return entry.get("scd"), entry.get("ingredients") or []

    def resolve_medication_code_to_ingredients(self, medication_code: str | int | None, medication_name: str = "") -> list[dict[str, Any]]:
        if medication_code not in (None, ""):
            scd, ingredients = self.resolve_scd_to_ingredients(medication_code)
            if scd:
                return ingredients

        if medication_name:
            entry = self.resolve_scd_by_name(medication_name)
            if entry:
                return entry.get("ingredients") or []

        return [{"rxcui": medication_code, "name": medication_name or str(medication_code)}] if medication_code not in (None, "") else []
