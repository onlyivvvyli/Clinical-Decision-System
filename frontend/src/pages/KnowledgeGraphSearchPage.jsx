import { useEffect, useMemo, useState } from "react";
import SectionCard from "../components/SectionCard";
import { api } from "../lib/api";

const TABLE_TOP_N_OPTIONS = [10, 20, 50, 100];
const GRAPH_TOP_N_OPTIONS = [10, 20, 50, "all"];
const GRAPH_EDGE_LIMIT = 30;
const GRAPH_NODE_LIMIT = 40;

function formatMetric(value) {
  if (value == null || value === "") {
    return "N/A";
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return String(value);
  }

  return numeric >= 10 ? numeric.toFixed(1).replace(/\.0$/, "") : numeric.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

function getNodeSubtitle(node) {
  if (!node) {
    return "";
  }

  const idEntries = Object.entries(node.ids || {});
  if (!idEntries.length) {
    return `ID ${node.primary_id}`;
  }

  return idEntries.map(([key, value]) => `${key}: ${value}`).join(" | ");
}

function normalizeSearchType(value) {
  return value === "all" ? "all entities" : value;
}

function supportsEvidenceMetrics(selectedNode) {
  return selectedNode?.entity_type !== "disease";
}

function formatSuggestionMeta(item) {
  const ids = Object.entries(item.ids || {})
    .map(([key, value]) => `${key}: ${value}`)
    .join(" | ");
  return ids || `ID ${item.primary_id}`;
}

function sortRelationships(items, sortBy, sortDirection) {
  const direction = sortDirection === "asc" ? 1 : -1;
  return [...items].sort((left, right) => {
    if (sortBy === "name") {
      return left.neighbor.name.localeCompare(right.neighbor.name) * direction;
    }

    const leftValue = Number(left[sortBy]);
    const rightValue = Number(right[sortBy]);
    const leftSafe = Number.isFinite(leftValue) ? leftValue : Number.NEGATIVE_INFINITY;
    const rightSafe = Number.isFinite(rightValue) ? rightValue : Number.NEGATIVE_INFINITY;

    if (leftSafe === rightSafe) {
      return left.neighbor.name.localeCompare(right.neighbor.name);
    }

    return (leftSafe - rightSafe) * direction;
  });
}

function buildGraphLayout(centerNode, relationships) {
  const width = 860;
  const height = 560;
  const center = { x: width / 2, y: height / 2 };
  const radiusX = Math.min(300, 180 + relationships.length * 4);
  const radiusY = Math.min(200, 130 + relationships.length * 2);
  const nodes = [
    {
      id: centerNode.neo4j_id,
      node: centerNode,
      x: center.x,
      y: center.y,
      isCenter: true,
    },
  ];

  const edges = relationships.map((relationship, index) => {
    const angle = (-Math.PI / 2) + ((Math.PI * 2) / Math.max(relationships.length, 1)) * index;
    const x = center.x + Math.cos(angle) * radiusX;
    const y = center.y + Math.sin(angle) * radiusY;
    nodes.push({
      id: relationship.neighbor.neo4j_id,
      node: relationship.neighbor,
      x,
      y,
      isCenter: false,
    });

    return {
      id: relationship.id,
      relationship,
      sourceX: center.x,
      sourceY: center.y,
      targetX: x,
      targetY: y,
      midX: (center.x + x) / 2,
      midY: (center.y + y) / 2,
    };
  });

  return { width, height, nodes, edges };
}

function SearchControls({
  query,
  setQuery,
  entityType,
  setEntityType,
  onSubmit,
  loading,
  suggestions,
  searchingSuggestions,
  onSelectSuggestion,
  hasResult,
}) {
  const showSuggestions = query.trim() && (searchingSuggestions || suggestions.length > 0);

  return (
    <form className={`kg-search-form ${hasResult ? "kg-search-form-inline" : "kg-search-form-hero"}`} onSubmit={onSubmit}>
      <label className="full-width autocomplete-field kg-search-input-field">
        <span className="kg-search-label">Search by drug or disease name or ID</span>
        <input
          className="kg-search-input"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Try metformin, 860975, diabetes, or 44054006"
        />
        {showSuggestions ? (
          <div className="autocomplete-list kg-autocomplete-list">
            {searchingSuggestions ? <div className="autocomplete-item muted-item">Searching...</div> : null}
            {suggestions.map((item) => (
              <button
                key={`${item.entity_type}-${item.neo4j_id}`}
                type="button"
                className="autocomplete-item kg-autocomplete-item"
                onClick={() => onSelectSuggestion(item)}
              >
                <strong>{item.name}</strong>
                <span>{item.entity_type === "drug" ? "Drug" : "Disease"} | {formatSuggestionMeta(item)}</span>
              </button>
            ))}
          </div>
        ) : null}
      </label>
      <label className="kg-search-scope">
        <span className="kg-search-label">Search scope</span>
        <select value={entityType} onChange={(event) => setEntityType(event.target.value)}>
          <option value="all">Drug or disease</option>
          <option value="drug">Drug only</option>
          <option value="disease">Disease only</option>
        </select>
      </label>
      <div className="kg-search-actions">
        <button type="submit" className="primary-button kg-search-submit" disabled={loading || !query.trim()}>
          {loading ? "Searching..." : "Search Knowledge Graph"}
        </button>
      </div>
    </form>
  );
}

function ResultToolbar({
  relationshipTypes,
  relationshipType,
  setRelationshipType,
  prrThreshold,
  setPrrThreshold,
  frequencyThreshold,
  setFrequencyThreshold,
  tableTopN,
  setTableTopN,
  keyword,
  setKeyword,
  sortBy,
  setSortBy,
  sortDirection,
  setSortDirection,
  graphTopN,
  setGraphTopN,
  activeTab,
  showEvidenceMetrics,
}) {
  return (
    <div className="kg-toolbar">
      <label>
        Relationship type
        <select value={relationshipType} onChange={(event) => setRelationshipType(event.target.value)}>
          <option value="all">All relationships</option>
          {relationshipTypes.map((item) => (
            <option key={item} value={item}>{item}</option>
          ))}
        </select>
      </label>
      {showEvidenceMetrics ? (
        <label>
          PRR threshold
          <input value={prrThreshold} onChange={(event) => setPrrThreshold(event.target.value)} inputMode="decimal" placeholder="No minimum" />
        </label>
      ) : null}
      {showEvidenceMetrics ? (
        <label>
          Frequency threshold
          <input value={frequencyThreshold} onChange={(event) => setFrequencyThreshold(event.target.value)} inputMode="decimal" placeholder="No minimum" />
        </label>
      ) : null}
      <label>
        Keyword filter
        <input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder={showEvidenceMetrics ? "Condition, node, or relationship" : "Node or relationship"} />
      </label>
      {activeTab === "graph" ? (
        <label>
          Graph Top N
          <select value={String(graphTopN)} onChange={(event) => setGraphTopN(event.target.value === "all" ? "all" : Number(event.target.value))}>
            {GRAPH_TOP_N_OPTIONS.map((item) => (
              <option key={String(item)} value={String(item)}>{item === "all" ? "All filtered" : `Top ${item}`}</option>
            ))}
          </select>
        </label>
      ) : (
        <label>
          Top N results
          <select value={String(tableTopN)} onChange={(event) => setTableTopN(Number(event.target.value))}>
            {TABLE_TOP_N_OPTIONS.map((item) => (
              <option key={item} value={item}>Top {item}</option>
            ))}
          </select>
        </label>
      )}
      <label>
        Sort by
        <select value={sortBy} onChange={(event) => setSortBy(event.target.value)}>
          {showEvidenceMetrics ? <option value="prr">PRR</option> : null}
          {showEvidenceMetrics ? <option value="frequency">Frequency</option> : null}
          <option value="name">Name</option>
        </select>
      </label>
      <label>
        Direction
        <select value={sortDirection} onChange={(event) => setSortDirection(event.target.value)}>
          <option value="desc">Descending</option>
          <option value="asc">Ascending</option>
        </select>
      </label>
    </div>
  );
}

function TabBar({ activeTab, setActiveTab }) {
  return (
    <div className="kg-tab-bar" role="tablist" aria-label="Knowledge graph result views">
      {[
        ["graph", "Graph"],
        ["table", "Table"],
        ["raw", "Raw"],
      ].map(([value, label]) => (
        <button
          key={value}
          type="button"
          role="tab"
          className={`kg-tab ${activeTab === value ? "active" : ""}`}
          aria-selected={activeTab === value}
          onClick={() => setActiveTab(value)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function GraphPanel({
  selectedNode,
  relationships,
  graphTopN,
  selectedGraphItem,
  setSelectedGraphItem,
  onNodeSearch,
}) {
  const showEvidenceMetrics = supportsEvidenceMetrics(selectedNode);
  const visibleRelationships = graphTopN === "all" ? relationships : relationships.slice(0, graphTopN);
  const nodeIds = new Set([selectedNode.neo4j_id, ...visibleRelationships.map((item) => item.neighbor.neo4j_id)]);
  const nodeCount = nodeIds.size;

  if (!visibleRelationships.length) {
    return <div className="empty-state">No graph relationships match the current filters.</div>;
  }

  if (visibleRelationships.length > GRAPH_EDGE_LIMIT || nodeCount > GRAPH_NODE_LIMIT) {
    return (
      <div className="selection-banner kg-guardrail-banner">
        <strong>Graph rendering paused for safety.</strong>
        <small>
          The current filtered result set has {visibleRelationships.length} edges and {nodeCount} nodes. Narrow the filters or choose a smaller Top N before rendering.
        </small>
      </div>
    );
  }

  const layout = buildGraphLayout(selectedNode, visibleRelationships);

  return (
    <div className="kg-graph-layout">
      <div className="kg-graph-stage">
        <svg viewBox={`0 0 ${layout.width} ${layout.height}`} className="kg-graph-svg" role="img" aria-label="Local knowledge graph subgraph">
          {layout.edges.map((edge) => {
            const isSelected = selectedGraphItem?.type === "edge" && selectedGraphItem.item.id === edge.relationship.id;
            return (
              <g key={edge.id}>
                <line
                  x1={edge.sourceX}
                  y1={edge.sourceY}
                  x2={edge.targetX}
                  y2={edge.targetY}
                  className={`kg-graph-edge ${isSelected ? "selected" : ""}`}
                  onClick={() => setSelectedGraphItem({ type: "edge", item: edge.relationship })}
                >
                  <title>
                    {`${edge.relationship.relationship_type} | ${edge.relationship.source.name} -> ${edge.relationship.target.name}`}
                  </title>
                </line>
                <rect
                  x={edge.midX - 14}
                  y={edge.midY - 14}
                  width="28"
                  height="28"
                  rx="14"
                  className="kg-graph-edge-hit"
                  onClick={() => setSelectedGraphItem({ type: "edge", item: edge.relationship })}
                >
                  <title>{edge.relationship.relationship_type}</title>
                </rect>
              </g>
            );
          })}
          {layout.nodes.map((entry) => {
            const isSelected = selectedGraphItem?.type === "node" && selectedGraphItem.item.neo4j_id === entry.node.neo4j_id;
            return (
              <g key={entry.id} onClick={() => setSelectedGraphItem({ type: "node", item: entry.node })} className="kg-graph-node-group">
                <circle
                  cx={entry.x}
                  cy={entry.y}
                  r={entry.isCenter ? 44 : 30}
                  className={`kg-graph-node ${entry.isCenter ? "center" : "neighbor"} ${isSelected ? "selected" : ""}`}
                >
                  <title>{`${entry.node.name}\n${getNodeSubtitle(entry.node)}`}</title>
                </circle>
                <text x={entry.x} y={entry.y + (entry.isCenter ? 6 : 5)} textAnchor="middle" className="kg-graph-node-text">
                  {entry.node.name.length > (entry.isCenter ? 18 : 14)
                    ? `${entry.node.name.slice(0, entry.isCenter ? 18 : 14)}...`
                    : entry.node.name}
                </text>
              </g>
            );
          })}
        </svg>
        <div className="kg-graph-caption">
          Showing {visibleRelationships.length} relationships from the queried node. Edge details appear on hover or when selected.
        </div>
      </div>

      <aside className="kg-side-panel">
        {selectedGraphItem?.type === "node" ? (
          <>
            <span className="eyebrow">Node Details</span>
            <h3>{selectedGraphItem.item.name}</h3>
            <p>{getNodeSubtitle(selectedGraphItem.item) || "No structured IDs available."}</p>
            <div className="kg-side-kv">
              <div>
                <span>Entity Type</span>
                <strong>{selectedGraphItem.item.entity_type}</strong>
              </div>
              <div>
                <span>Labels</span>
                <strong>{(selectedGraphItem.item.labels || []).join(", ") || "N/A"}</strong>
              </div>
            </div>
            <button type="button" className="ghost-button" onClick={() => onNodeSearch(selectedGraphItem.item)}>
              Search From This Node
            </button>
          </>
        ) : selectedGraphItem?.type === "edge" ? (
          <>
            <span className="eyebrow">Edge Details</span>
            <h3>{selectedGraphItem.item.relationship_type}</h3>
            <p>{selectedGraphItem.item.source.name} to {selectedGraphItem.item.target.name}</p>
            <div className="kg-side-kv">
              {showEvidenceMetrics && selectedGraphItem.item.prr != null ? (
                <div>
                  <span>PRR</span>
                  <strong>{formatMetric(selectedGraphItem.item.prr)}</strong>
                </div>
              ) : null}
              {showEvidenceMetrics && selectedGraphItem.item.frequency != null ? (
                <div>
                  <span>Frequency</span>
                  <strong>{formatMetric(selectedGraphItem.item.frequency)}</strong>
                </div>
              ) : null}
              {showEvidenceMetrics ? (
                <div>
                  <span>Condition</span>
                  <strong>{selectedGraphItem.item.condition_name || "N/A"}</strong>
                </div>
              ) : null}
            </div>
            <div className="kg-property-block">
              <strong>Raw edge properties</strong>
              <pre>{JSON.stringify(selectedGraphItem.item.properties || {}, null, 2)}</pre>
            </div>
          </>
        ) : (
          <>
            <span className="eyebrow">Graph Details</span>
            <h3>Select a node or edge</h3>
            <p>Hover for quick IDs, then click any node or edge to inspect it here.</p>
          </>
        )}
      </aside>
    </div>
  );
}

function TablePanel({ relationships, showEvidenceMetrics }) {
  if (!relationships.length) {
    return <div className="empty-state">No relationship rows match the current filters.</div>;
  }

  return (
    <div className="table-wrapper">
      <table>
        <thead>
          <tr>
            <th>Neighbor</th>
            <th>Neighbor ID</th>
            <th>Relationship</th>
            {showEvidenceMetrics ? <th>Condition</th> : null}
            {showEvidenceMetrics ? <th>PRR</th> : null}
            {showEvidenceMetrics ? <th>Frequency</th> : null}
          </tr>
        </thead>
        <tbody>
          {relationships.map((item) => (
            <tr key={item.id}>
              <td>{item.neighbor.name}</td>
              <td>{item.neighbor.primary_id}</td>
              <td>{item.relationship_type}</td>
              {showEvidenceMetrics ? <td>{item.condition_name || "N/A"}</td> : null}
              {showEvidenceMetrics ? <td>{formatMetric(item.prr)}</td> : null}
              {showEvidenceMetrics ? <td>{formatMetric(item.frequency)}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RawPanel({ payload }) {
  return (
    <pre className="kg-raw-panel">{JSON.stringify(payload, null, 2)}</pre>
  );
}

export default function KnowledgeGraphSearchPage() {
  const [query, setQuery] = useState("");
  const [entityType, setEntityType] = useState("all");
  const [suggestions, setSuggestions] = useState([]);
  const [searchingSuggestions, setSearchingSuggestions] = useState(false);
  const [activeTab, setActiveTab] = useState("table");
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [relationshipType, setRelationshipType] = useState("all");
  const [prrThreshold, setPrrThreshold] = useState("");
  const [frequencyThreshold, setFrequencyThreshold] = useState("");
  const [tableTopN, setTableTopN] = useState(50);
  const [graphTopN, setGraphTopN] = useState(10);
  const [keyword, setKeyword] = useState("");
  const [sortBy, setSortBy] = useState("prr");
  const [sortDirection, setSortDirection] = useState("desc");
  const [selectedGraphItem, setSelectedGraphItem] = useState(null);
  const showEvidenceMetrics = supportsEvidenceMetrics(result?.selected_node);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setSuggestions([]);
      setSearchingSuggestions(false);
      return undefined;
    }

    const timer = setTimeout(async () => {
      setSearchingSuggestions(true);
      try {
        const data = await api.searchKnowledgeGraphSuggestions(trimmed, entityType);
        setSuggestions(Array.isArray(data) ? data : []);
      } catch {
        setSuggestions([]);
      } finally {
        setSearchingSuggestions(false);
      }
    }, 200);

    return () => clearTimeout(timer);
  }, [query, entityType]);

  const handleSearch = async (event) => {
    event.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) {
      return;
    }

    setStatus("loading");
    setError("");
    setSuggestions([]);
    setSelectedGraphItem(null);

    try {
      const data = await api.searchKnowledgeGraph(trimmed, entityType);
      setResult(data);
      setActiveTab("table");
      setRelationshipType("all");
      setPrrThreshold("");
      setFrequencyThreshold("");
      setKeyword("");
      setSortBy(supportsEvidenceMetrics(data?.selected_node) ? "prr" : "name");
      setSortDirection("desc");
      setGraphTopN(10);
      setTableTopN(50);
      setStatus("done");
    } catch (loadError) {
      setError(loadError.message || "Search failed.");
      setResult(null);
      setStatus("error");
    }
  };

  const filteredRelationships = useMemo(() => {
    const items = result?.relationships || [];
    const prrMin = Number(prrThreshold);
    const frequencyMin = Number(frequencyThreshold);
    const normalizedKeyword = keyword.trim().toLowerCase();

    return sortRelationships(
      items.filter((item) => {
        if (relationshipType !== "all" && item.relationship_type !== relationshipType) {
          return false;
        }
        if (prrThreshold !== "" && (!Number.isFinite(prrMin) || Number(item.prr) < prrMin)) {
          return false;
        }
        if (frequencyThreshold !== "" && (!Number.isFinite(frequencyMin) || Number(item.frequency) < frequencyMin)) {
          return false;
        }
        if (normalizedKeyword && !String(item.keywords || "").toLowerCase().includes(normalizedKeyword)) {
          return false;
        }
        return true;
      }),
      sortBy,
      sortDirection,
    );
  }, [result, relationshipType, prrThreshold, frequencyThreshold, keyword, sortBy, sortDirection]);

  const tableRelationships = useMemo(
    () => filteredRelationships.slice(0, tableTopN),
    [filteredRelationships, tableTopN],
  );

  const rawPayload = useMemo(
    () => ({
      searched_query: result?.query,
      searched_entity_type: result?.entity_type,
      selected_node: result?.selected_node,
      filtered_relationships: filteredRelationships,
      total_filtered_relationships: filteredRelationships.length,
      raw: result?.raw,
    }),
    [result, filteredRelationships],
  );

  const handleNodeSearch = async (node) => {
    if (!node?.primary_id && !node?.name) {
      return;
    }

    const nextQuery = node.primary_id || node.name;
    setQuery(nextQuery);
    setEntityType(node.entity_type === "entity" ? "all" : node.entity_type);
    setSuggestions([]);
    setActiveTab("table");
    setSelectedGraphItem(null);
    setStatus("loading");
    setError("");

    try {
      const data = await api.searchKnowledgeGraph(nextQuery, node.entity_type === "entity" ? "all" : node.entity_type);
      setResult(data);
      setSortBy(supportsEvidenceMetrics(data?.selected_node) ? "prr" : "name");
      setPrrThreshold("");
      setFrequencyThreshold("");
      setStatus("done");
    } catch (loadError) {
      setError(loadError.message || "Search failed.");
      setResult(null);
      setStatus("error");
    }
  };

  const handleSuggestionSelect = (item) => {
    setQuery(item.primary_id || item.name);
    setEntityType(item.entity_type === "entity" ? "all" : item.entity_type);
    setSuggestions([]);
  };

  return (
    <div className="page-stack">
      <section className={`kg-search-shell ${result?.selected_node ? "with-results" : ""}`}>
        <div className="kg-search-hero-copy">
          <p className="eyebrow">Knowledge Graph Search</p>
        </div>

        <div className="kg-search-surface">
          <SearchControls
            query={query}
            setQuery={setQuery}
            entityType={entityType}
            setEntityType={setEntityType}
            onSubmit={handleSearch}
            loading={status === "loading"}
            suggestions={suggestions}
            searchingSuggestions={searchingSuggestions}
            onSelectSuggestion={handleSuggestionSelect}
            hasResult={Boolean(result?.selected_node)}
          />
          {error ? <div className="error-banner">{error}</div> : null}
          {status === "done" && result && !result.selected_node ? (
            <div className="empty-state kg-search-empty">No {normalizeSearchType(entityType)} matched "{result.query}".</div>
          ) : null}
        </div>
      </section>

      {result?.selected_node ? (
        <SectionCard
          title="Results"
          subtitle={`Showing relationships for ${result.selected_node.name} (${getNodeSubtitle(result.selected_node) || result.selected_node.primary_id}).`}
          actions={<TabBar activeTab={activeTab} setActiveTab={setActiveTab} />}
        >
          <div className="selection-banner kg-result-summary">
            <span>Matched node</span>
            <strong>{result.selected_node.name}</strong>
            <small>{getNodeSubtitle(result.selected_node) || "No structured IDs available."}</small>
          </div>

          <ResultToolbar
            relationshipTypes={result.available_relationship_types || []}
            relationshipType={relationshipType}
            setRelationshipType={setRelationshipType}
            prrThreshold={prrThreshold}
            setPrrThreshold={setPrrThreshold}
            frequencyThreshold={frequencyThreshold}
            setFrequencyThreshold={setFrequencyThreshold}
            tableTopN={tableTopN}
            setTableTopN={setTableTopN}
            keyword={keyword}
            setKeyword={setKeyword}
            sortBy={sortBy}
            setSortBy={setSortBy}
            sortDirection={sortDirection}
            setSortDirection={setSortDirection}
            graphTopN={graphTopN}
            setGraphTopN={setGraphTopN}
            activeTab={activeTab}
            showEvidenceMetrics={showEvidenceMetrics}
          />

          {activeTab === "graph" ? (
            <GraphPanel
              selectedNode={result.selected_node}
              relationships={filteredRelationships}
              graphTopN={graphTopN}
              selectedGraphItem={selectedGraphItem}
              setSelectedGraphItem={setSelectedGraphItem}
              onNodeSearch={handleNodeSearch}
            />
          ) : null}
          {activeTab === "table" ? <TablePanel relationships={tableRelationships} showEvidenceMetrics={showEvidenceMetrics} /> : null}
          {activeTab === "raw" ? <RawPanel payload={rawPayload} /> : null}
        </SectionCard>
      ) : null}
    </div>
  );
}
