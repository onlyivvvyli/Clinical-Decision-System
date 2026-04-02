from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import alerts, auth, kg, mappings, patients, prescriptions
from app.core.config import get_settings
from app.db.seed import seed_database
from app.db.session import Base, engine


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(bind=engine)
    seed_database()
    yield


settings = get_settings()

app = FastAPI(
    title="Clinician Prescribing Safety Prototype",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api", tags=["auth"])
app.include_router(patients.router, prefix="/api", tags=["patients"])
app.include_router(prescriptions.router, prefix="/api", tags=["prescriptions"])
app.include_router(alerts.router, prefix="/api", tags=["alerts"])
app.include_router(mappings.router, prefix="/api", tags=["mappings"])
app.include_router(kg.router, prefix="/api", tags=["knowledge-graph"])


@app.get("/health")
async def health():
    return {"status": "ok"}

