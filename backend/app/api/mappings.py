from fastapi import APIRouter, HTTPException, Query

from app.services.mapping_service import MappingService

router = APIRouter()
mapping_service = MappingService()


@router.get("/mappings/scds")
def search_scds(query: str = Query(default=""), limit: int = Query(default=10, ge=1, le=50)):
    try:
        return mapping_service.search_scds(query=query, limit=limit)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
