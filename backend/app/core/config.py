from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


BACKEND_ROOT = Path(__file__).resolve().parents[2]
ENV_PATH = BACKEND_ROOT / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(ENV_PATH),
        env_file_encoding="utf-8",
        populate_by_name=True,
    )

    app_name: str = "Clinician Prescribing Safety Prototype"
    fhir_base_url: str = Field(default="http://localhost:8080/fhir", alias="FHIR_BASE_URL")
    neo4j_uri: str = Field(default="", alias="NEO4J_URI")
    neo4j_username: str = Field(default="", alias="NEO4J_USERNAME")
    neo4j_password: str = Field(default="", alias="NEO4J_PASSWORD")
    openai_api_key: str = Field(default="", alias="OPENAI_API_KEY")
    openai_base_url: str = Field(default="https://api.openai.com/v1", alias="OPENAI_BASE_URL")
    openai_model: str = Field(default="gpt-5-mini", alias="OPENAI_MODEL")
    openai_timeout_seconds: float = Field(default=20.0, alias="OPENAI_TIMEOUT_SECONDS")
    sqlite_db_path: str = Field(default="./demo.db", alias="SQLITE_DB_PATH")
    mapping_json_path: str = Field(
        default=str(BACKEND_ROOT / "app" / "data" / "scd_ingredient_mapping.json"),
        alias="MAPPING_JSON_PATH",
    )
    cors_origins_raw: str = Field(default="http://localhost:5173", alias="CORS_ORIGINS")

    @property
    def cors_origins(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins_raw.split(",") if origin.strip()]

    @property
    def sqlite_url(self) -> str:
        db_path = Path(self.sqlite_db_path)
        if not db_path.is_absolute():
            db_path = (BACKEND_ROOT / db_path).resolve()
        db_path.parent.mkdir(parents=True, exist_ok=True)
        return f"sqlite:///{db_path.as_posix()}"

    @property
    def resolved_mapping_json_path(self) -> Path:
        mapping_path = Path(self.mapping_json_path)
        if not mapping_path.is_absolute():
            mapping_path = (BACKEND_ROOT / mapping_path).resolve()
        return mapping_path


@lru_cache
def get_settings() -> Settings:
    return Settings()
