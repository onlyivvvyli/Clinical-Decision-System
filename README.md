# Clinician Prescribing Safety Prototype

An English-language clinician-facing web prototype for prescription risk alerts. The system authenticates doctors from local SQLite, reads patient context from FHIR, checks drug-drug interactions in Neo4j Aura, keeps a reserved drug-disease module placeholder, and writes approved prescriptions back to FHIR.

## Tech Stack

- Frontend: React + Vite
- Backend: FastAPI
- Local DB: SQLite
- Knowledge Graph: Neo4j Aura
- Clinical Data Source: FHIR server

## Project Structure

```text
backend/
  app/
    api/
    core/
    db/
    schemas/
    services/
  init_db.py
  init_db.sql
  requirements.txt
frontend/
  src/
    components/
    context/
    lib/
    pages/
```

## Implemented Workflow

1. Doctor logs in with local SQLite-backed credentials.
2. Dashboard shows doctor info, patient count, and recent prescription logs.
3. Patient list loads from FHIR `Patient`.
4. Patient detail page loads:
   - Basic info
   - Current conditions from FHIR `Condition`
   - Current medications from FHIR `MedicationRequest`
   - Medication history from FHIR `MedicationRequest`
5. Doctor enters a new medication.
6. Backend runs the alert engine:
   - Pulls patient data from FHIR
   - Runs DDI check through Neo4j Aura
   - Runs drug-disease placeholder module
7. If blocked, alerts are returned and write-back is skipped.
8. If approved, a new `MedicationRequest` is posted to FHIR.
9. Every submit attempt is logged to local SQLite.

## Placeholder Module

The drug-disease module already exists in the backend and frontend response structure, but it is intentionally a placeholder for now.

Current response:

```json
{
  "implemented": false,
  "alerts": [],
  "message": "Drug-disease module reserved for future KG integration."
}
```

## Backend Setup

### 1. Create and activate a virtual environment

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
```

### 2. Install dependencies

```powershell
pip install -r requirements.txt
```

### 3. Configure environment variables

Copy `backend/.env.example` to `backend/.env` and fill in your values:

```env
FHIR_BASE_URL=http://localhost:8080/fhir
NEO4J_URI=neo4j+s://your-aura-instance.databases.neo4j.io
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=your-password
SQLITE_DB_PATH=./backend/demo.db
CORS_ORIGINS=http://localhost:5173
```

### 4. Initialize SQLite

Option A:

```powershell
python init_db.py
```

Option B:

Run `backend/init_db.sql` manually in SQLite.

Seeded demo doctor:

- Username: `doctor1`
- Password: `123456`
- Name: `Dr. Demo`

### 5. Start the backend

Run from the repository root:

```powershell
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000 --app-dir backend
```

## Frontend Setup

### 1. Install dependencies

```powershell
cd frontend
npm install
```

### 2. Configure frontend environment

Copy `frontend/.env.example` to `frontend/.env`:

```env
VITE_API_BASE_URL=http://localhost:8000/api
```

### 3. Start the frontend

```powershell
npm run dev
```

Frontend routes:

- `/login`
- `/dashboard`
- `/patients`
- `/patients/:id`

## API Summary

### Auth

- `POST /api/login`

### Patients

- `GET /api/patients`
- `GET /api/patients/{patient_id}`
- `GET /api/patients/{patient_id}/summary`

### Prescriptions

- `POST /api/prescriptions/check`
- `POST /api/prescriptions/submit`

### Alerts

- `GET /api/alerts`

## Notes on FHIR and KG Integration

- FHIR is the source of truth for patients, conditions, current meds, history, and new medication write-back.
- Neo4j Aura is only used for DDI in this phase.
- DDI logic only compares the proposed medication against current active medications.
- Historical medications are displayed but do not block prescribing in v1.
- If Neo4j credentials are missing, the DDI service will not return matches.
- If FHIR fields are incomplete, the backend uses defensive parsing to avoid frontend crashes.

## External HAPI FHIR Server

This repository does not include the local `hapi-fhir-jpaserver-starter/` directory or its data files.

If you want to run the full workflow locally, start a compatible HAPI FHIR server separately and point `FHIR_BASE_URL` in `backend/.env` to that server, for example:

```env
FHIR_BASE_URL=http://localhost:8080/fhir
```

The excluded HAPI FHIR folder is treated as a local development dependency rather than part of this repository.

## Demo Notes

This is a phase-one prototype optimized for workflow completeness rather than full production hardening. The most important loop is already structured for future extension:

- Add disease-aware KG rules in `backend/app/services/kg_service.py`
- Extend orchestration in `backend/app/services/alert_engine.py`
- Expand UI sections in `frontend/src/pages/PatientDetailPage.jsx`

## Current Limitations

- Authentication is intentionally simple and not JWT-based.
- Passwords are stored in plaintext for demo purposes only.
- No full authorization or role model yet.
- Neo4j graph schema is assumed to contain `Drug` nodes and `DDI` relationships keyed by `code`.
- Drug-disease checking is reserved but not implemented.
