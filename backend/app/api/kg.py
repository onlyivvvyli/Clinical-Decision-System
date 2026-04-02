from fastapi import APIRouter, HTTPException, Query

from app.services.kg_service import KGService

router = APIRouter()
kg_service = KGService()


@router.get("/knowledge-graph/search")
def search_knowledge_graph(
    query: str = Query(min_length=1),
    entity_type: str = Query(default="all", pattern="^(all|drug|disease)$"),
    limit: int = Query(default=200, ge=1, le=500),
):
    try:
        return kg_service.search_local_subgraph(query=query, entity_type=entity_type, limit=limit)
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
