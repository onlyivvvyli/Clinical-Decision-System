from __future__ import annotations

from neo4j import GraphDatabase
from neo4j.exceptions import Neo4jError

from app.core.config import get_settings

PRR_FOOTNOTE = (
    "Proportional Reporting Ratio (PRR) is a measure of how often a specific condition is reported "
    "for a drug or drug combination compared to other drugs."
)
MRF_FOOTNOTE = (
    "Mean reporting frequency reflects how commonly a condition is reported overall for this drug pair, "
    "independent of comparisons to other drugs."
)


class KGService:
    def __init__(self):
        self.settings = get_settings()
        self.driver = None
        if self.settings.neo4j_uri and self.settings.neo4j_username and self.settings.neo4j_password:
            self.driver = GraphDatabase.driver(
                self.settings.neo4j_uri,
                auth=(self.settings.neo4j_username, self.settings.neo4j_password),
            )

    @staticmethod
    def _normalize_numeric_string(value: str | int | float | None) -> str:
        if value is None or value == "":
            return ""
        if isinstance(value, str):
            return value.strip()
        if isinstance(value, float) and value.is_integer():
            return str(int(value))
        return str(value)

    @staticmethod
    def format_prr_text(prr: float) -> str:
        rounded = max(1, round(float(prr)))
        return f"~{rounded}x more frequently reported than expected"

    @staticmethod
    def format_mean_reporting_frequency_text(mrf: float | None) -> str:
        if mrf is None:
            return "reported overall"
        if mrf >= 0.1:
            return "very commonly reported overall"
        if mrf >= 0.03:
            return "commonly reported overall"
        if mrf >= 0.005:
            return "occasionally reported overall"
        return "rarely reported overall"

    @classmethod
    def format_condition_display_text(cls, condition_name: str, prr: float, mrf: float | None) -> str:
        prr_text = cls.format_prr_text(prr)
        freq_text = cls.format_mean_reporting_frequency_text(mrf)
        return f"{condition_name} ({prr_text}; {freq_text})"

    @classmethod
    def build_ddi_prompt_payload(
        cls,
        drug_a_name: str,
        drug_b_name: str,
        evidence_items: list[dict],
        *,
        drug_name: str | None = None,
        combination_ingredients: list[str] | None = None,
        trigger_ingredient: str | None = None,
        current_medication: str | None = None,
    ) -> dict:
        top_conditions = []
        for item in evidence_items:
            condition_name = item.get("condition_name")
            prr = item.get("prr")
            if condition_name in (None, "") or prr is None:
                continue

            mrf = item.get("mean_reporting_frequency")
            top_conditions.append(
                {
                    "condition_name": condition_name,
                    "prr": float(prr),
                    "mean_reporting_frequency": None if mrf is None else float(mrf),
                    "prr_text": cls.format_prr_text(float(prr)),
                    "freq_text": cls.format_mean_reporting_frequency_text(None if mrf is None else float(mrf)),
                    "display_text": cls.format_condition_display_text(condition_name, float(prr), None if mrf is None else float(mrf)),
                }
            )

        return {
            "drug_name": drug_name or drug_a_name,
            "drug_a": drug_a_name,
            "drug_b": drug_b_name,
            "combination_ingredients": [item for item in (combination_ingredients or []) if item],
            "trigger_ingredient": trigger_ingredient or drug_a_name,
            "current_medication": current_medication or drug_b_name,
            "top_conditions": top_conditions,
            "prr_footnote": PRR_FOOTNOTE,
            "mrf_footnote": MRF_FOOTNOTE,
        }

    def ddi_exists(
        self,
        ingredient_a: str | int,
        ingredient_b: str | int,
        minimum_prr: float | None = None,
    ) -> bool:
        evidence = self.get_top_ddi_evidence(
            ingredient_a,
            ingredient_b,
            limit=1,
            minimum_prr=minimum_prr,
        )
        return bool(evidence)

    def get_top_ddi_evidence(
        self,
        drug1_rxnorm_id: str | int,
        drug2_rxnorm_id: str | int,
        limit: int = 5,
        minimum_prr: float | None = None,
    ) -> list[dict]:
        drug_1 = self._normalize_numeric_string(drug1_rxnorm_id)
        drug_2 = self._normalize_numeric_string(drug2_rxnorm_id)
        if not self.driver or not drug_1 or not drug_2:
            return []

        evidence_query = """
        MATCH (d1:Drug)-[r]-(d2:Drug)
        WHERE type(r) IN ['Interact_with', 'INTERACT_WITH']
          AND (
            (
              toString(coalesce(d1.rxnorm_id, d1.rxcui)) = $drug_1
              AND toString(coalesce(d2.rxnorm_id, d2.rxcui)) = $drug_2
            )
            OR
            (
              toString(coalesce(d1.rxnorm_id, d1.rxcui)) = $drug_2
              AND toString(coalesce(d2.rxnorm_id, d2.rxcui)) = $drug_1
            )
          )
        WITH trim(coalesce(r.condition_name, '')) AS condition_name,
             toFloatOrNull(r.PRR) AS prr,
             toFloatOrNull(r.mean_reporting_frequency) AS mean_reporting_frequency
        WHERE condition_name <> '' AND prr IS NOT NULL
          AND ($minimum_prr IS NULL OR prr >= $minimum_prr)
        RETURN condition_name, prr, mean_reporting_frequency
        ORDER BY prr DESC, condition_name ASC
        LIMIT $limit
        """

        try:
            with self.driver.session() as session:
                records = [
                    dict(record)
                    for record in session.run(
                        evidence_query,
                        drug_1=drug_1,
                        drug_2=drug_2,
                        limit=limit,
                        minimum_prr=minimum_prr,
                    )
                ]
        except Neo4jError as exc:
            raise RuntimeError(f"Neo4j DDI evidence query failed: {exc.message}") from exc

        seen_condition_names = set()
        evidence = []
        for record in records:
            condition_name = record.get("condition_name")
            prr = record.get("prr")
            mrf = record.get("mean_reporting_frequency")
            if condition_name in (None, "") or prr is None:
                continue

            dedupe_key = condition_name.strip().casefold()
            if dedupe_key in seen_condition_names:
                continue

            seen_condition_names.add(dedupe_key)
            evidence.append(
                {
                    "condition_name": condition_name,
                    "prr": float(prr),
                    "mean_reporting_frequency": None if mrf is None else float(mrf),
                    "prr_text": self.format_prr_text(float(prr)),
                    "freq_text": self.format_mean_reporting_frequency_text(None if mrf is None else float(mrf)),
                    "display_text": self.format_condition_display_text(
                        condition_name,
                        float(prr),
                        None if mrf is None else float(mrf),
                    ),
                }
            )

        return evidence

    def debug_ddi_pair(self, ingredient_a: str | int, ingredient_b: str | int) -> dict:
        drug_1 = self._normalize_numeric_string(ingredient_a)
        drug_2 = self._normalize_numeric_string(ingredient_b)
        if not self.driver or not drug_1 or not drug_2:
            return {
                "driver_available": bool(self.driver),
                "drug_1": drug_1,
                "drug_2": drug_2,
                "strict_match_found": False,
                "strict_matches": [],
                "node_probe": [],
            }

        strict_query = """
        MATCH (d1:Drug)-[r]-(d2:Drug)
        WHERE type(r) IN ['Interact_with', 'INTERACT_WITH']
          AND (
            (
              toString(coalesce(d1.rxnorm_id, d1.rxcui)) = $drug_1
              AND toString(coalesce(d2.rxnorm_id, d2.rxcui)) = $drug_2
            )
            OR
            (
              toString(coalesce(d1.rxnorm_id, d1.rxcui)) = $drug_2
              AND toString(coalesce(d2.rxnorm_id, d2.rxcui)) = $drug_1
            )
          )
        RETURN
          type(r) AS relationship_type,
          toString(coalesce(d1.rxnorm_id, d1.rxcui)) AS d1_id,
          coalesce(d1.name, d1.drug_name, '') AS d1_name,
          toString(coalesce(d2.rxnorm_id, d2.rxcui)) AS d2_id,
          coalesce(d2.name, d2.drug_name, '') AS d2_name
        LIMIT 10
        """

        node_probe_query = """
        MATCH (d:Drug)
        WHERE toString(coalesce(d.rxnorm_id, d.rxcui)) IN [$drug_1, $drug_2]
        RETURN toString(coalesce(d.rxnorm_id, d.rxcui)) AS drug_id,
               coalesce(d.name, d.drug_name, '') AS drug_name,
               keys(d) AS available_properties
        LIMIT 10
        """

        try:
            with self.driver.session() as session:
                strict_matches = [dict(record) for record in session.run(strict_query, drug_1=drug_1, drug_2=drug_2)]
                node_probe = [dict(record) for record in session.run(node_probe_query, drug_1=drug_1, drug_2=drug_2)]
        except Neo4jError as exc:
            raise RuntimeError(f"Neo4j DDI query failed: {exc.message}") from exc

        return {
            "driver_available": True,
            "drug_1": drug_1,
            "drug_2": drug_2,
            "strict_match_found": bool(strict_matches),
            "strict_matches": strict_matches,
            "node_probe": node_probe,
        }

    def check_drug_disease(
        self,
        ingredient_rxcui: str | int,
        patient_conditions: list[dict],
        *,
        include_contraindications: bool = True,
        include_off_label: bool = True,
    ):
        drug_code = self._normalize_numeric_string(ingredient_rxcui)
        if not self.driver or not drug_code:
            return {"contraindications": [], "off_label": []}

        snomed_codes = []
        seen_codes = set()
        for condition in patient_conditions:
            for code in condition.get("snomed_codes", []):
                normalized = self._normalize_numeric_string(code)
                if normalized and normalized not in seen_codes:
                    seen_codes.add(normalized)
                    snomed_codes.append(normalized)

        if not snomed_codes:
            return {"contraindications": [], "off_label": []}

        contraindication_query = """
        MATCH (drug:Drug)-[r]->(d:Disease)
        WHERE type(r) IN ['CONTRAINDICATION', 'Contraindicted_for']
          AND toString(coalesce(drug.rxnorm_id, drug.rxcui)) = $drug_code
          AND toString(d.snomed_conceptid) IN $snomed_codes
        RETURN coalesce(d.concept_name, d.name, d.snomed_full_name) AS disease_name, toString(coalesce(d.concept_id, d.disease_id)) AS disease_id, toString(d.snomed_conceptid) AS snomed_code
        ORDER BY disease_name
        """

        off_label_query = """
        MATCH (drug:Drug)-[r]->(d:Disease)
        WHERE type(r) IN ['OFF_LABEL_USE', 'Off-label_use_for']
          AND toString(coalesce(drug.rxnorm_id, drug.rxcui)) = $drug_code
          AND toString(d.snomed_conceptid) IN $snomed_codes
        RETURN coalesce(d.concept_name, d.name, d.snomed_full_name) AS disease_name, toString(coalesce(d.concept_id, d.disease_id)) AS disease_id, toString(d.snomed_conceptid) AS snomed_code
        ORDER BY disease_name
        """

        try:
            with self.driver.session() as session:
                contraindications = (
                    [
                        dict(record)
                        for record in session.run(contraindication_query, drug_code=drug_code, snomed_codes=snomed_codes)
                    ]
                    if include_contraindications
                    else []
                )
                off_label = (
                    [
                        dict(record)
                        for record in session.run(off_label_query, drug_code=drug_code, snomed_codes=snomed_codes)
                    ]
                    if include_off_label
                    else []
                )
        except Neo4jError as exc:
            raise RuntimeError(f"Neo4j drug-disease query failed: {exc.message}") from exc

        return {"contraindications": contraindications, "off_label": off_label}

    def search_entity_suggestions(self, query: str, *, entity_type: str = "all", limit: int = 8) -> list[dict]:
        normalized_query = self._normalize_numeric_string(query)
        if not self.driver or not normalized_query:
            return []

        label_filter = (
            "WHERE any(label IN labels(n) WHERE label IN ['Drug', 'Disease'])"
            if entity_type == "all"
            else f"WHERE '{entity_type.capitalize()}' IN labels(n)"
        )

        suggestions_query = f"""
        MATCH (n)
        {label_filter}
        WITH n,
             labels(n) AS labels,
             coalesce(n.name, n.drug_name, n.concept_name, n.snomed_full_name, '') AS display_name,
             toString(coalesce(n.rxnorm_id, n.rxcui, n.concept_id, n.disease_id, n.snomed_conceptid, id(n))) AS primary_id,
             [value IN [
               toString(n.rxnorm_id),
               toString(n.rxcui),
               toString(n.concept_id),
               toString(n.disease_id),
               toString(n.snomed_conceptid)
             ] WHERE value IS NOT NULL AND trim(value) <> ''] AS id_candidates
        WHERE display_name <> ''
          AND (
            toLower(display_name) CONTAINS toLower($search_term)
            OR any(candidate IN id_candidates WHERE candidate CONTAINS $search_term)
            OR primary_id CONTAINS $search_term
          )
        RETURN
          n,
          labels,
          display_name,
          primary_id,
          CASE
            WHEN any(candidate IN id_candidates WHERE candidate = $search_term) OR primary_id = $search_term THEN 0
            WHEN toLower(display_name) = toLower($search_term) THEN 1
            WHEN toLower(display_name) STARTS WITH toLower($search_term) THEN 2
            ELSE 3
          END AS rank
        ORDER BY rank ASC, size(display_name) ASC, display_name ASC
        LIMIT $limit
        """

        try:
            with self.driver.session() as session:
                records = list(
                    session.run(
                        suggestions_query,
                        search_term=normalized_query,
                        limit=limit,
                    )
                )
        except Neo4jError as exc:
            raise RuntimeError(f"Neo4j knowledge graph suggestion search failed: {exc.message}") from exc

        suggestions = []
        for record in records:
            node = record["n"]
            labels = record["labels"]
            props = dict(node)
            suggestions.append(
                {
                    "neo4j_id": str(node.id),
                    "name": record["display_name"] or f"Node {node.id}",
                    "primary_id": self._normalize_numeric_string(record["primary_id"]),
                    "entity_type": "drug" if "Drug" in labels else "disease" if "Disease" in labels else "entity",
                    "labels": labels,
                    "ids": {
                        key: self._normalize_numeric_string(value)
                        for key, value in props.items()
                        if key in {"rxnorm_id", "rxcui", "concept_id", "disease_id", "snomed_conceptid"} and value not in (None, "")
                    },
                }
            )

        return suggestions

    def search_local_subgraph(self, query: str, *, entity_type: str = "all", limit: int = 200) -> dict:
        normalized_query = self._normalize_numeric_string(query)
        if not self.driver or not normalized_query:
            return {
                "query": normalized_query,
                "entity_type": entity_type,
                "selected_node": None,
                "relationships": [],
                "available_relationship_types": [],
                "total_relationships": 0,
                "raw": {"matches": [], "nodes": [], "edges": []},
            }

        label_filter = (
            "WHERE any(label IN labels(n) WHERE label IN ['Drug', 'Disease'])"
            if entity_type == "all"
            else f"WHERE '{entity_type.capitalize()}' IN labels(n)"
        )

        search_query = f"""
        MATCH (n)
        {label_filter}
        WITH n,
             coalesce(n.name, n.drug_name, n.concept_name, n.snomed_full_name, '') AS display_name,
             toString(coalesce(n.rxnorm_id, n.rxcui, n.concept_id, n.disease_id, n.snomed_conceptid, id(n))) AS display_id,
             [value IN [
               toString(n.rxnorm_id),
               toString(n.rxcui),
               toString(n.concept_id),
               toString(n.disease_id),
               toString(n.snomed_conceptid)
             ] WHERE value IS NOT NULL AND trim(value) <> ''] AS id_candidates
        WHERE (
            toLower(display_name) CONTAINS toLower($search_term)
            OR any(candidate IN id_candidates WHERE candidate = $search_term)
            OR display_id = $search_term
          )
        RETURN
          n,
          labels(n) AS labels,
          CASE
            WHEN any(candidate IN id_candidates WHERE candidate = $search_term) OR display_id = $search_term THEN 0
            WHEN toLower(display_name) = toLower($search_term) THEN 1
            WHEN toLower(display_name) STARTS WITH toLower($search_term) THEN 2
            ELSE 3
          END AS rank,
          display_name
        ORDER BY rank ASC, size(display_name) ASC, display_name ASC
        LIMIT 1
        """

        relationship_query = """
        MATCH (q)-[r]-(neighbor)
        WHERE id(q) = $node_id
        WITH q, r, neighbor,
             CASE WHEN startNode(r) = q THEN q ELSE neighbor END AS source_node,
             CASE WHEN startNode(r) = q THEN neighbor ELSE q END AS target_node
        RETURN
          q,
          labels(q) AS query_labels,
          source_node,
          labels(source_node) AS source_labels,
          target_node,
          labels(target_node) AS target_labels,
          neighbor,
          labels(neighbor) AS neighbor_labels,
          r,
          type(r) AS relationship_type
        LIMIT $limit
        """

        try:
            with self.driver.session() as session:
                match_record = session.run(search_query, search_term=normalized_query).single()
                if match_record is None:
                    return {
                        "query": normalized_query,
                        "entity_type": entity_type,
                        "selected_node": None,
                        "relationships": [],
                        "available_relationship_types": [],
                        "total_relationships": 0,
                        "raw": {"matches": [], "nodes": [], "edges": []},
                    }

                query_node = match_record["n"]
                records = list(session.run(relationship_query, node_id=query_node.id, limit=limit))
        except Neo4jError as exc:
            raise RuntimeError(f"Neo4j knowledge graph search failed: {exc.message}") from exc

        def serialize_node(node, labels: list[str]) -> dict:
            props = dict(node)
            return {
                "neo4j_id": str(node.id),
                "labels": labels,
                "entity_type": "drug" if "Drug" in labels else "disease" if "Disease" in labels else "entity",
                "name": (
                    props.get("name")
                    or props.get("drug_name")
                    or props.get("concept_name")
                    or props.get("snomed_full_name")
                    or f"Node {node.id}"
                ),
                "primary_id": self._normalize_numeric_string(
                    props.get("rxnorm_id")
                    or props.get("rxcui")
                    or props.get("concept_id")
                    or props.get("disease_id")
                    or props.get("snomed_conceptid")
                    or node.id
                ),
                "ids": {
                    key: self._normalize_numeric_string(value)
                    for key, value in props.items()
                    if key in {"rxnorm_id", "rxcui", "concept_id", "disease_id", "snomed_conceptid"} and value not in (None, "")
                },
                "properties": props,
            }

        selected_node = serialize_node(query_node, match_record["labels"])
        relationships = []
        node_map = {selected_node["neo4j_id"]: selected_node}

        for index, record in enumerate(records):
            source = serialize_node(record["source_node"], record["source_labels"])
            target = serialize_node(record["target_node"], record["target_labels"])
            neighbor = serialize_node(record["neighbor"], record["neighbor_labels"])
            edge_props = dict(record["r"])
            prr = edge_props.get("PRR")
            mean_reporting_frequency = edge_props.get("mean_reporting_frequency")

            node_map[source["neo4j_id"]] = source
            node_map[target["neo4j_id"]] = target
            node_map[neighbor["neo4j_id"]] = neighbor
            relationships.append(
                {
                    "id": f"{record['r'].element_id}-{index}",
                    "relationship_type": record["relationship_type"],
                    "source": source,
                    "target": target,
                    "neighbor": neighbor,
                    "prr": None if prr in (None, "") else float(prr),
                    "mean_reporting_frequency": None if mean_reporting_frequency in (None, "") else float(mean_reporting_frequency),
                    "frequency": None if mean_reporting_frequency in (None, "") else float(mean_reporting_frequency),
                    "condition_name": edge_props.get("condition_name"),
                    "keywords": " ".join(
                        str(part)
                        for part in [
                            record["relationship_type"],
                            source["name"],
                            target["name"],
                            edge_props.get("condition_name"),
                            edge_props.get("description"),
                        ]
                        if part
                    ),
                    "properties": edge_props,
                }
            )

        relationships.sort(
            key=lambda item: (
                -(item["prr"] if item["prr"] is not None else float("-inf")),
                -(item["frequency"] if item["frequency"] is not None else float("-inf")),
                item["neighbor"]["name"].casefold(),
            )
        )

        return {
            "query": normalized_query,
            "entity_type": entity_type,
            "selected_node": selected_node,
            "relationships": relationships,
            "available_relationship_types": sorted({item["relationship_type"] for item in relationships}),
            "total_relationships": len(relationships),
            "raw": {
                "matches": [selected_node],
                "nodes": list(node_map.values()),
                "edges": relationships,
            },
        }


