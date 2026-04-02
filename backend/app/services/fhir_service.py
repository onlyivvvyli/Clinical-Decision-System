from __future__ import annotations

from datetime import date, datetime, timedelta

import httpx

from app.core.config import get_settings


class FHIRServiceError(Exception):
    pass


class FHIRService:
    _client: httpx.AsyncClient | None = None
    _cache: dict[tuple[str, str | None], tuple[datetime, object]] = {}
    _cache_ttl = timedelta(seconds=30)

    def __init__(self):
        self.settings = get_settings()

    @classmethod
    def _get_client(cls) -> httpx.AsyncClient:
        if cls._client is None:
            cls._client = httpx.AsyncClient(
                timeout=15.0,
                limits=httpx.Limits(max_keepalive_connections=10, max_connections=20),
            )
        return cls._client

    @classmethod
    def _get_cached(cls, key: tuple[str, str | None]):
        cached = cls._cache.get(key)
        if not cached:
            return None

        expires_at, value = cached
        if expires_at <= datetime.utcnow():
            cls._cache.pop(key, None)
            return None
        return value

    @classmethod
    def _set_cached(cls, key: tuple[str, str | None], value: object):
        cls._cache[key] = (datetime.utcnow() + cls._cache_ttl, value)

    @classmethod
    def _invalidate_patient_cache(cls, patient_id: str):
        cls._cache = {
            key: value
            for key, value in cls._cache.items()
            if key not in {
                ("patient", patient_id),
                ("conditions", patient_id),
                ("medications", patient_id),
            }
        }

    async def _get_bundle(self, resource_type: str, patient_id: str | None = None):
        params = {}
        if patient_id:
            params["patient"] = patient_id
        url = f"{self.settings.fhir_base_url.rstrip('/')}/{resource_type}"
        entries = []

        try:
            client = self._get_client()
            next_url = url
            next_params = params

            while next_url:
                response = await client.get(next_url, params=next_params)
                response.raise_for_status()
                bundle = response.json()
                entries.extend(bundle.get("entry", []))

                next_link = next(
                    (link.get("url") for link in bundle.get("link", []) if link.get("relation") == "next"),
                    None,
                )
                next_url = next_link
                next_params = None

            return {"entry": entries}
        except httpx.HTTPError as exc:
            raise FHIRServiceError(f"FHIR request failed for {resource_type}: {exc}") from exc

    async def _get_resource(self, resource_type: str, resource_id: str):
        url = f"{self.settings.fhir_base_url.rstrip('/')}/{resource_type}/{resource_id}"
        try:
            client = self._get_client()
            response = await client.get(url)
            if response.status_code == 404:
                return None
            response.raise_for_status()
            return response.json()
        except httpx.HTTPError as exc:
            raise FHIRServiceError(f"FHIR request failed for {resource_type}/{resource_id}: {exc}") from exc

    @staticmethod
    def _format_human_name(name_block: dict | None) -> str:
        if not name_block:
            return "Unknown"
        given = " ".join(name_block.get("given", []))
        family = name_block.get("family", "")
        full = f"{given} {family}".strip()
        return full or name_block.get("text") or "Unknown"

    @staticmethod
    def _compute_age(birth_date: str | None) -> str:
        if not birth_date:
            return "Unknown"
        try:
            born = datetime.strptime(birth_date, "%Y-%m-%d").date()
            today = date.today()
            years = today.year - born.year - ((today.month, today.day) < (born.month, born.day))
            return str(years)
        except ValueError:
            return "Unknown"

    @staticmethod
    def _extract_code(codeable: dict | None) -> tuple[str, str]:
        if not codeable:
            return "Unknown", ""
        coding = (codeable.get("coding") or [{}])[0]
        return codeable.get("text") or coding.get("display") or "Unknown", coding.get("code") or ""

    @staticmethod
    def _extract_snomed_codes(codeable: dict | None) -> list[str]:
        if not codeable:
            return []
        snomed_codes = []
        for coding in codeable.get("coding") or []:
            if coding.get("system") == "http://snomed.info/sct" and coding.get("code"):
                snomed_codes.append(str(coding.get("code")))
        return snomed_codes

    async def get_patients(self):
        cache_key = ("patients", None)
        cached = self._get_cached(cache_key)
        if cached is not None:
            return cached

        bundle = await self._get_bundle("Patient")
        entries = bundle.get("entry", [])
        patients = []
        for entry in entries:
            resource = entry.get("resource", {})
            birth_date = resource.get("birthDate", "")
            patients.append(
                {
                    "id": resource.get("id", ""),
                    "name": self._format_human_name((resource.get("name") or [{}])[0]),
                    "gender": resource.get("gender", "unknown"),
                    "birth_date": birth_date,
                    "age": self._compute_age(birth_date),
                }
            )
        self._set_cached(cache_key, patients)
        return patients

    async def get_patient(self, patient_id: str):
        cache_key = ("patient", patient_id)
        cached = self._get_cached(cache_key)
        if cached is not None:
            return cached

        resource = await self._get_resource("Patient", patient_id)
        if not resource:
            return None
        birth_date = resource.get("birthDate", "")
        patient = {
            "id": resource.get("id", ""),
            "name": self._format_human_name((resource.get("name") or [{}])[0]),
            "gender": resource.get("gender", "unknown"),
            "birth_date": birth_date,
            "age": self._compute_age(birth_date),
        }
        self._set_cached(cache_key, patient)
        return patient

    async def get_patient_conditions(self, patient_id: str):
        cache_key = ("conditions", patient_id)
        cached = self._get_cached(cache_key)
        if cached is not None:
            return cached

        bundle = await self._get_bundle("Condition", patient_id)
        conditions = []
        for entry in bundle.get("entry", []):
            resource = entry.get("resource", {})
            codeable = resource.get("code")
            name, code = self._extract_code(codeable)
            clinical_status = (
                ((resource.get("clinicalStatus") or {}).get("coding") or [{}])[0].get("code") or "unknown"
            )
            conditions.append(
                {
                    "name": name,
                    "code": code,
                    "clinical_status": clinical_status,
                    "onset_date": resource.get("onsetDateTime"),
                    "snomed_codes": self._extract_snomed_codes(codeable),
                }
            )
        self._set_cached(cache_key, conditions)
        return conditions

    async def get_patient_medications(self, patient_id: str):
        cache_key = ("medications", patient_id)
        cached = self._get_cached(cache_key)
        if cached is not None:
            return cached

        bundle = await self._get_bundle("MedicationRequest", patient_id)
        current = []
        history = []
        for entry in bundle.get("entry", []):
            resource = entry.get("resource", {})
            med_name, med_code = self._extract_code(resource.get("medicationCodeableConcept"))
            dosage = ((resource.get("dosageInstruction") or [{}])[0]).get("text")
            period_block = ((resource.get("dispenseRequest") or {}).get("validityPeriod") or {})
            period = " to ".join(
                [value for value in [period_block.get("start"), period_block.get("end")] if value]
            ) or None
            item = {
                "id": resource.get("id"),
                "name": med_name,
                "code": med_code,
                "status": resource.get("status", "unknown"),
                "authored_on": resource.get("authoredOn"),
                "dosage_text": dosage,
                "period": period,
            }
            if resource.get("status") == "active":
                current.append(item)
            else:
                history.append(item)
        medications = {"current": current, "history": history}
        self._set_cached(cache_key, medications)
        return medications

    async def create_medication_request(self, patient_id: str, med_data: dict):
        payload = {
            "resourceType": "MedicationRequest",
            "status": "active",
            "intent": "order",
            "subject": {"reference": f"Patient/{patient_id}"},
            "medicationCodeableConcept": {
                "coding": [
                    {
                        "system": "http://www.nlm.nih.gov/research/umls/rxnorm",
                        "code": med_data.get("medication_code") or "",
                        "display": med_data.get("medication_name"),
                    }
                ],
                "text": med_data.get("medication_name"),
            },
            "authoredOn": datetime.utcnow().date().isoformat(),
            "dosageInstruction": [
                {
                    "text": f"{med_data.get('dosage')} | {med_data.get('frequency')}",
                }
            ],
            "note": [{"text": med_data.get("reason") or "Prototype prescribing workflow"}],
        }
        url = f"{self.settings.fhir_base_url.rstrip('/')}/MedicationRequest"
        try:
            client = self._get_client()
            response = await client.post(url, json=payload)
            response.raise_for_status()
            resource = response.json()
            self._invalidate_patient_cache(patient_id)
            return {
                "status": "success",
                "resource_type": resource.get("resourceType", "MedicationRequest"),
                "resource_id": resource.get("id"),
            }
        except httpx.HTTPError as exc:
            raise FHIRServiceError(f"Failed to create MedicationRequest in FHIR: {exc}") from exc
