# Clinician Prescribing Safety Prototype

A clinician-facing web prototype for prescription safety review. The system authenticates doctors from local SQLite, reads patient context from FHIR, checks medication risk through a Neo4j-backed knowledge graph, generates clinician-friendly alert explanations, and writes continued prescriptions back to FHIR.

## What The Project Does

This prototype focuses on the prescribing workflow rather than isolated demos.

End-to-end flow:

1. A doctor signs in with local SQLite-backed credentials.
2. The dashboard shows doctor context, patient count, recent prescription activity, and the current safety setting snapshot.
3. The patient list loads from FHIR `Patient` resources.
4. The patient detail page loads:
   - Basic patient info
   - Current conditions from FHIR `Condition`
   - Current active medications from FHIR `MedicationRequest`
   - Medication history from FHIR `MedicationRequest`
5. The doctor opens the prescribe flow and selects an SCD medication.
6. The backend resolves the selected SCD to ingredient-level RxCUI mappings.
7. The alert engine:
   - Pulls patient context from FHIR
   - Resolves current active medications to ingredients
   - Runs drug-drug interaction checks through Neo4j Aura
   - Runs drug-disease checks against active conditions
   - Optionally generates clinician-friendly alert explanations through OpenAI
8. If blocking risk alerts are found, the review UI shows them before submission.
9. If the doctor continues, a new `MedicationRequest` is written back to FHIR.
10. Every prescription submission is logged to local SQLite.

## Current Features

- React + Vite frontend with protected routes for clinician workflow
- FastAPI backend with SQLite-backed doctor login and prescription logs
- FHIR integration for patients, conditions, medications, and write-back
- Neo4j Aura integration for:
  - DDI evidence lookup
  - Drug-disease relationship lookup
  - Searchable local subgraph exploration
- SCD-to-ingredient mapping via local JSON mapping data
- Configurable clinical safety settings:
  - DDI strictness
  - Drug-disease strictness
  - AI explanation style
- Knowledge graph search page with:
  - Search suggestions
  - Table view
  - Interactive graph view
  - PRR / frequency filters for evidence-backed relationships
- Defensive parsing so incomplete FHIR fields do not crash the frontend

## Tech Stack

- Frontend: React + Vite
- Backend: FastAPI
- Local DB: SQLite
- HTTP client: httpx
- Knowledge Graph: Neo4j Aura
- Clinical Data Source: FHIR server
- Optional AI explanations: OpenAI Responses API

## Project Structure

```text
backend/
  app/
    api/
    core/
    data/
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

Create `backend/.env` and fill in your values.

Example:

```env
FHIR_BASE_URL=http://localhost:8080/fhir
NEO4J_URI=neo4j+s://your-aura-instance.databases.neo4j.io
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=your-password
SQLITE_DB_PATH=./demo.db
CORS_ORIGINS=http://localhost:5173
OPENAI_API_KEY=
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-5-mini
OPENAI_TIMEOUT_SECONDS=20
MAPPING_JSON_PATH=./app/data/scd_ingredient_mapping.json
```

Environment variables currently used by the backend:

- `FHIR_BASE_URL`
- `NEO4J_URI`
- `NEO4J_USERNAME`
- `NEO4J_PASSWORD`
- `SQLITE_DB_PATH`
- `CORS_ORIGINS`
- `OPENAI_API_KEY`
- `OPENAI_BASE_URL`
- `OPENAI_MODEL`
- `OPENAI_TIMEOUT_SECONDS`
- `MAPPING_JSON_PATH`

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

Health check:

- `GET /health`

## Frontend Setup

### 1. Install dependencies

```powershell
cd frontend
npm install
```

### 2. Configure frontend environment

Create `frontend/.env`:

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
- `/settings`
- `/patients`
- `/patients/:id`
- `/knowledge-graph`

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
- `POST /api/prescriptions/explain-ddi`

### Alerts

- `GET /api/alerts`

### Mappings

- `GET /api/mappings/scds`

### Knowledge Graph

- `GET /api/knowledge-graph/search`
- `GET /api/knowledge-graph/suggestions`

## Notes On Safety Logic

- The selected medication is resolved from SCD to ingredient level before safety checks.
- DDI checks compare the proposed medication ingredients against current active medication ingredients.
- DDI strictness supports:
  - `off`
  - `standard`
  - `high_signal`
  - `strict`
- Drug-disease strictness supports:
  - `off`
  - `contraindication_only`
  - `full`
- Off-label drug-disease matches are shown as references and do not block prescribing by themselves.
- Blocking behavior is currently triggered by:
  - DDI alerts
  - Drug-disease contraindication alerts
- If both DDI and drug-disease checking are turned off, the frontend can bypass the review step and submit directly.

## Notes On OpenAI Integration

- OpenAI is used only for explanation generation, not for core rule execution.
- If `OPENAI_API_KEY` is not set, the backend falls back to deterministic explanation text.
- AI explanation styles supported by the backend:
  - `conservative`
  - `balanced`
  - `exploratory`

## Notes On FHIR And KG Integration

- FHIR is the source of truth for patient demographics, conditions, current meds, history, and new medication write-back.
- Neo4j Aura is used for both DDI evidence lookup and drug-disease relationship lookup.
- The knowledge graph search page is intended for exploration and demo visibility, separate from the prescribing workflow.
- Historical medications are shown for context but do not currently block prescribing.
- If Neo4j credentials are missing, knowledge graph-backed checks and search will not return expected results.

## External HAPI FHIR Server

This repository includes a local `hapi-fhir-jpaserver-starter/` directory in the workspace, but the prescribing app is designed to point to a separately running FHIR server through `FHIR_BASE_URL`.

If you want to run the full workflow locally, start a compatible HAPI FHIR server and point `FHIR_BASE_URL` in `backend/.env` to that server, for example:

```env
FHIR_BASE_URL=http://localhost:8080/fhir
```

## Current Limitations

- Authentication is intentionally simple and not JWT-based.
- Passwords are stored in plaintext for demo purposes only.
- No full authorization or role model yet.
- The project is prototype-oriented and not production hardened.
- Drug-disease logic is implemented at the current rule level, but can still be expanded with richer KG rules and validation.
- System behavior depends on external FHIR and Neo4j data quality.
