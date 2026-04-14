import { useEffect, useMemo, useRef, useState } from "react";
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY } from "d3-force";



import SectionCard from "../components/SectionCard";



import { api } from "../lib/api";







const TABLE_TOP_N_OPTIONS = [10, 20, 50, 100];



const GRAPH_TOP_N_OPTIONS = [10, 20, 50, "all"];



const GRAPH_EDGE_LIMIT = 30;



const GRAPH_NODE_LIMIT = 40;

const GRAPH_MIN_SCALE = 0.65;

const GRAPH_MAX_SCALE = 2.4;







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







function clampGraphScale(value) {

  return Math.min(GRAPH_MAX_SCALE, Math.max(GRAPH_MIN_SCALE, value));

}

function createGraphPositionMap(layout) {

  return Object.fromEntries(layout.nodes.map((entry) => [entry.id, { x: entry.x, y: entry.y }]));

}

function getGraphPointerPosition(svgElement, event, width, height) {

  if (!svgElement) {

    return { x: 0, y: 0 };

  }

  const rect = svgElement.getBoundingClientRect();

  if (!rect.width || !rect.height) {

    return { x: 0, y: 0 };

  }

  return {

    x: ((event.clientX - rect.left) / rect.width) * width,

    y: ((event.clientY - rect.top) / rect.height) * height,

  };

}

function truncateGraphLabel(value, maxLength) {

  if (!value) {

    return "";

  }

  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;

}

function buildInteractiveGraphData(centerNode, relationships) {

  const layout = buildGraphLayout(centerNode, relationships);

  const nodeMap = new Map();

  layout.nodes.forEach((entry) => {

    const key = String(entry.id);

    if (!nodeMap.has(key) || entry.isCenter) {

      nodeMap.set(key, {

        id: key,

        node: entry.node,

        x: entry.x,

        y: entry.y,

        isCenter: entry.isCenter,

      });

    }

  });

  const nodes = Array.from(nodeMap.values());

  const pairGroups = new Map();

  const edges = relationships.map((relationship) => {

    const sourceId = String(centerNode.neo4j_id);

    const targetId = String(relationship.neighbor.neo4j_id);

    const pairKey = [sourceId, targetId].sort().join("::");

    const siblings = pairGroups.get(pairKey) || [];

    const edge = {

      id: String(relationship.id),

      sourceId,

      targetId,

      pairKey,

      relationship,

      siblingIndex: siblings.length,

      siblingCount: 1,

    };

    siblings.push(edge);

    pairGroups.set(pairKey, siblings);

    return edge;

  });

  pairGroups.forEach((siblings) => {

    siblings.forEach((edge, index) => {

      edge.siblingIndex = index;

      edge.siblingCount = siblings.length;

    });

  });

  return {

    width: layout.width,

    height: layout.height,

    nodes,

    edges,

  };

}

function getCurvedEdgeGeometry(edge, sourceNode, targetNode) {

  if (!sourceNode || !targetNode) {

    return { path: "", labelX: 0, labelY: 0 };

  }

  const dx = targetNode.x - sourceNode.x;

  const dy = targetNode.y - sourceNode.y;

  const distance = Math.hypot(dx, dy) || 1;

  const normalX = -dy / distance;

  const normalY = dx / distance;

  const spread = edge.siblingCount > 1 ? 32 : 0;

  const offset = (edge.siblingIndex - (edge.siblingCount - 1) / 2) * spread;

  const controlX = (sourceNode.x + targetNode.x) / 2 + normalX * offset;

  const controlY = (sourceNode.y + targetNode.y) / 2 + normalY * offset;

  const labelX = (sourceNode.x + (2 * controlX) + targetNode.x) / 4;

  const labelY = (sourceNode.y + (2 * controlY) + targetNode.y) / 4;

  return {

    path: `M ${sourceNode.x} ${sourceNode.y} Q ${controlX} ${controlY} ${targetNode.x} ${targetNode.y}`,

    labelX,

    labelY,

  };

}

function SearchControls({



  query,



  setQuery,



  onSubmit,



  loading,



  suggestions,



  searchingSuggestions,



  showNoSuggestions,



  onSelectSuggestion,



  hasResult,



  searchFieldRef,



}) {



  const showSuggestions = query.trim() && (searchingSuggestions || showNoSuggestions || suggestions.length > 0);







  return (



    <form className={`kg-search-form ${hasResult ? "kg-search-form-inline" : "kg-search-form-hero"}`} onSubmit={onSubmit}>



      <label ref={searchFieldRef} className="full-width autocomplete-field kg-search-input-field">



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



            {!searchingSuggestions && showNoSuggestions ? <div className="autocomplete-item muted-item">No results found.</div> : null}



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

  const svgRef = useRef(null);

  const simulationRef = useRef(null);

  const pointerStateRef = useRef(null);

  const frameRef = useRef(0);

  const simulationNodesRef = useRef([]);

  const visibleRelationships = useMemo(

    () => (graphTopN === "all" ? relationships : relationships.slice(0, graphTopN)),

    [relationships, graphTopN],

  );

  const nodeIds = new Set([selectedNode.neo4j_id, ...visibleRelationships.map((item) => item.neighbor.neo4j_id)]);

  const nodeCount = nodeIds.size;

  const graphData = useMemo(() => buildInteractiveGraphData(selectedNode, visibleRelationships), [selectedNode, visibleRelationships]);

  const [graphSnapshot, setGraphSnapshot] = useState(graphData);

  const [viewport, setViewport] = useState({ x: 0, y: 0, scale: 1 });

  const scheduleSnapshot = () => {

    if (frameRef.current) {

      return;

    }

    frameRef.current = window.requestAnimationFrame(() => {

      frameRef.current = 0;

      setGraphSnapshot((current) => ({

        ...current,

        nodes: simulationNodesRef.current.map((node) => ({

          id: node.id,

          node: node.node,

          isCenter: node.isCenter,

          x: node.x,

          y: node.y,

        })),

      }));

    });

  };

  useEffect(() => {

    const centerId = String(selectedNode.neo4j_id);

    const nodes = graphData.nodes.map((entry) => ({ ...entry }));

    const links = graphData.edges.map((edge) => ({

      source: edge.sourceId,

      target: edge.targetId,

      distance: edge.siblingCount > 1 ? 205 : 175,

    }));

    const centerNodeEntry = nodes.find((node) => node.id === centerId);

    if (centerNodeEntry) {

      centerNodeEntry.x = graphData.width / 2;

      centerNodeEntry.y = graphData.height / 2;

    }

    simulationNodesRef.current = nodes;

    setGraphSnapshot({ ...graphData, nodes });

    setViewport({ x: 0, y: 0, scale: 1 });

    pointerStateRef.current = null;

    const simulation = forceSimulation(nodes)

      .force("link", forceLink(links).id((node) => node.id).distance((link) => link.distance).strength(0.72))

      .force("charge", forceManyBody().strength(-720))

      .force("center", forceCenter(graphData.width / 2, graphData.height / 2))

      .force("x", forceX(graphData.width / 2).strength((node) => (node.isCenter ? 0.22 : 0.045)))

      .force("y", forceY(graphData.height / 2).strength((node) => (node.isCenter ? 0.22 : 0.045)))

      .force("collide", forceCollide().radius((node) => (node.isCenter ? 62 : 42)).iterations(2));

    simulation.alpha(1).alphaDecay(0.055);

    simulation.on("tick", scheduleSnapshot);

    simulationRef.current = simulation;

    scheduleSnapshot();

    return () => {

      simulation.stop();

      simulationRef.current = null;

      if (frameRef.current) {

        window.cancelAnimationFrame(frameRef.current);

        frameRef.current = 0;

      }

    };

  }, [graphData, selectedNode.neo4j_id]);

  const nodeLookup = useMemo(

    () => Object.fromEntries(graphSnapshot.nodes.map((entry) => [entry.id, entry])),

    [graphSnapshot.nodes],

  );

  const renderedEdges = useMemo(() => {

    return graphSnapshot.edges.map((edge) => {

      const sourceNode = nodeLookup[edge.sourceId];

      const targetNode = nodeLookup[edge.targetId];

      const geometry = getCurvedEdgeGeometry(edge, sourceNode, targetNode);

      return {

        ...edge,

        ...geometry,

      };

    }).filter((edge) => edge.path);

  }, [graphSnapshot.edges, nodeLookup]);

  const resetViewport = () => {

    setViewport({ x: 0, y: 0, scale: 1 });

  };

  const zoomViewport = (direction) => {

    setViewport((current) => ({

      ...current,

      scale: clampGraphScale(current.scale * direction),

    }));

  };

  const handleWheel = (event) => {

    event.preventDefault();

    event.stopPropagation();

    const svgElement = svgRef.current;

    const pointer = getGraphPointerPosition(svgElement, event, graphData.width, graphData.height);

    setViewport((current) => {

      const nextScale = clampGraphScale(current.scale * (event.deltaY < 0 ? 1.12 : 0.88));

      if (nextScale === current.scale) {

        return current;

      }

      const scaleRatio = nextScale / current.scale;

      return {

        scale: nextScale,

        x: pointer.x - (pointer.x - current.x) * scaleRatio,

        y: pointer.y - (pointer.y - current.y) * scaleRatio,

      };

    });

  };

  const handleStagePointerDown = (event) => {

    if (event.button !== 0) {

      return;

    }

    event.preventDefault();

    const svgElement = svgRef.current;

    const pointer = getGraphPointerPosition(svgElement, event, graphData.width, graphData.height);

    pointerStateRef.current = {

      mode: "pan",

      pointerId: event.pointerId,

      startPointer: pointer,

      startViewport: viewport,

      moved: false,

    };

    svgElement?.setPointerCapture?.(event.pointerId);

  };

  const handleNodePointerDown = (event, entry) => {

    if (event.button !== 0) {

      return;

    }

    event.preventDefault();

    event.stopPropagation();

    pointerStateRef.current = {

      mode: "node",

      pointerId: event.pointerId,

      nodeId: entry.id,

      moved: false,

    };

    svgRef.current?.setPointerCapture?.(event.pointerId);

  };

  const handlePointerMove = (event) => {

    const pointerState = pointerStateRef.current;

    if (!pointerState || pointerState.pointerId !== event.pointerId) {

      return;

    }

    const pointer = getGraphPointerPosition(svgRef.current, event, graphData.width, graphData.height);

    if (pointerState.mode === "pan") {

      const deltaX = pointer.x - pointerState.startPointer.x;

      const deltaY = pointer.y - pointerState.startPointer.y;

      if (!pointerState.moved && Math.abs(deltaX) + Math.abs(deltaY) > 3) {

        pointerState.moved = true;

      }

      setViewport({

        ...pointerState.startViewport,

        x: pointerState.startViewport.x + deltaX,

        y: pointerState.startViewport.y + deltaY,

      });

      return;

    }

    if (pointerState.mode === "node") {

      const simNode = simulationNodesRef.current.find((node) => node.id === pointerState.nodeId);

      if (!simNode) {

        return;

      }

      pointerState.moved = true;

      simNode.fx = (pointer.x - viewport.x) / viewport.scale;

      simNode.fy = (pointer.y - viewport.y) / viewport.scale;

      simulationRef.current?.alphaTarget(0.22).restart();

      scheduleSnapshot();

    }

  };

  useEffect(() => {

    const svgElement = svgRef.current;

    if (!svgElement) {

      return undefined;

    }

    const handleNativeWheel = (event) => {

      handleWheel(event);

    };

    svgElement.addEventListener("wheel", handleNativeWheel, { passive: false });

    return () => svgElement.removeEventListener("wheel", handleNativeWheel);

  }, [graphData.height, graphData.width, viewport.scale, viewport.x, viewport.y]);

  const clearPointerState = (event) => {

    const pointerState = pointerStateRef.current;

    if (!pointerState || pointerState.pointerId !== event.pointerId) {

      return;

    }

    if (pointerState.mode === "node") {

      const simNode = simulationNodesRef.current.find((node) => node.id === pointerState.nodeId);

      if (simNode && !simNode.isCenter) {

        simNode.fx = null;

        simNode.fy = null;

      }

      simulationRef.current?.alphaTarget(0);

      simulationRef.current?.alpha(0.25).restart();

      if (!pointerState.moved) {

        const entry = nodeLookup[pointerState.nodeId];

        if (entry) {

          setSelectedGraphItem({ type: "node", item: entry.node });

        }

      }

    }

    svgRef.current?.releasePointerCapture?.(event.pointerId);

    pointerStateRef.current = null;

  };

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

  return (

    <div className="kg-graph-layout">

      <div className="kg-graph-stage">

        <svg

          ref={svgRef}

          viewBox={`0 0 ${graphData.width} ${graphData.height}`}

          className="kg-graph-svg"

          role="img"

          aria-label="Interactive force-directed knowledge graph"

          onPointerMove={handlePointerMove}

          onPointerUp={clearPointerState}

          onPointerCancel={clearPointerState}

        >

          <defs>

            <marker id="kg-graph-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">

              <path d="M 0 0 L 10 5 L 0 10 z" className="kg-graph-arrow-marker" />

            </marker>

            <marker id="kg-graph-arrow-selected" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">

              <path d="M 0 0 L 10 5 L 0 10 z" className="kg-graph-arrow-marker selected" />

            </marker>

          </defs>

          <rect

            x="0"

            y="0"

            width={graphData.width}

            height={graphData.height}

            className="kg-graph-backdrop"

            onPointerDown={handleStagePointerDown}

          />

          <g transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.scale})`}>

            {renderedEdges.map((edge) => {

              const isSelected = selectedGraphItem?.type === "edge" && selectedGraphItem.item.id === edge.relationship.id;

              return (

                <g key={edge.id}>

                  <path

                    d={edge.path}

                    className={`kg-graph-edge ${isSelected ? "selected" : ""}`}

                    markerEnd={`url(#${isSelected ? "kg-graph-arrow-selected" : "kg-graph-arrow"})`}

                    onClick={(event) => {

                      event.stopPropagation();

                      setSelectedGraphItem({ type: "edge", item: edge.relationship });

                    }}

                  >

                    <title>{`${edge.relationship.relationship_type} | ${edge.relationship.source.name} -> ${edge.relationship.target.name}`}</title>

                  </path>

                  <path

                    d={edge.path}

                    className="kg-graph-edge-hit"

                    onClick={(event) => {

                      event.stopPropagation();

                      setSelectedGraphItem({ type: "edge", item: edge.relationship });

                    }}

                  />

                  {renderedEdges.length <= 12 ? (

                    <text x={edge.labelX} y={edge.labelY} className="kg-graph-edge-label" textAnchor="middle">

                      {truncateGraphLabel(edge.relationship.relationship_type, 20)}

                    </text>

                  ) : null}

                </g>

              );

            })}

            {graphSnapshot.nodes.map((entry) => {

              const isSelected = selectedGraphItem?.type === "node" && selectedGraphItem.item.neo4j_id === entry.node.neo4j_id;

              return (

                <g

                  key={entry.id}

                  className={`kg-graph-node-group ${pointerStateRef.current?.nodeId === entry.id ? "dragging" : ""}`}

                  onPointerDown={(event) => handleNodePointerDown(event, entry)}

                >

                  <circle

                    cx={entry.x}

                    cy={entry.y}

                    r={entry.isCenter ? 42 : 30}

                    className={`kg-graph-node ${entry.isCenter ? "center" : "neighbor"} ${isSelected ? "selected" : ""}`}

                  >

                    <title>{`${entry.node.name}
${getNodeSubtitle(entry.node)}`}</title>

                  </circle>

                  <text x={entry.x} y={entry.y + (entry.isCenter ? 6 : 5)} textAnchor="middle" className="kg-graph-node-text">

                    {truncateGraphLabel(entry.node.name, entry.isCenter ? 16 : 14)}

                  </text>

                </g>

              );

            })}

          </g>

        </svg>

        <button type="button" className="ghost-button kg-graph-reset-fab" onClick={resetViewport}>Reset view</button>


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

            <p>Click a node for details, drag it to reshape the force layout, or click an edge to inspect the relationship here.</p>

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







function ParticleBackground() {



  const canvasRef = useRef(null);







  useEffect(() => {



    const canvas = canvasRef.current;



    if (!canvas) {



      return undefined;



    }







    const context = canvas.getContext("2d");



    if (!context) {



      return undefined;



    }







    let animationFrame = 0;



    let width = 0;



    let height = 0;



    let particles = [];



    const pointer = { x: -9999, y: -9999, active: false };



    const particleCount = 128;



    const connectionDistance = 145;



    const palette = [



      "rgba(32, 79, 112, 0.88)",



      "rgba(43, 111, 156, 0.82)",



      "rgba(93, 136, 168, 0.76)",



    ];







    const resize = () => {



      const parent = canvas.parentElement;



      if (!parent) {



        return;



      }







      width = parent.clientWidth;



      height = parent.clientHeight;



      const ratio = Math.min(window.devicePixelRatio || 1, 2);



      canvas.width = Math.max(1, Math.floor(width * ratio));



      canvas.height = Math.max(1, Math.floor(height * ratio));



      canvas.style.width = `${width}px`;



      canvas.style.height = `${height}px`;



      context.setTransform(ratio, 0, 0, ratio, 0, 0);







      particles = Array.from({ length: particleCount }, (_, index) => ({



        x: Math.random() * width,



        y: Math.random() * height,



        vx: (Math.random() - 0.5) * 0.32,



        vy: (Math.random() - 0.5) * 0.32,



        radius: 0.8 + Math.random() * 1.8,



        color: palette[index % palette.length],



      }));



    };







    const draw = () => {



      context.clearRect(0, 0, width, height);







      for (let i = 0; i < particles.length; i += 1) {



        const particle = particles[i];



        particle.x += particle.vx;



        particle.y += particle.vy;







        if (particle.x < -20) particle.x = width + 20;



        if (particle.x > width + 20) particle.x = -20;



        if (particle.y < -20) particle.y = height + 20;



        if (particle.y > height + 20) particle.y = -20;







        for (let j = i + 1; j < particles.length; j += 1) {



          const other = particles[j];



          const dx = particle.x - other.x;



          const dy = particle.y - other.y;



          const distance = Math.hypot(dx, dy);







          if (distance < connectionDistance) {



            const alpha = (1 - distance / connectionDistance) * 0.34;



            context.beginPath();



            context.moveTo(particle.x, particle.y);



            context.lineTo(other.x, other.y);



            context.strokeStyle = `rgba(43, 111, 156, ${alpha})`;



            context.lineWidth = 1;



            context.stroke();



          }



        }







        if (pointer.active) {



          const dx = particle.x - pointer.x;



          const dy = particle.y - pointer.y;



          const distance = Math.hypot(dx, dy);



          if (distance < 165) {



            const alpha = (1 - distance / 165) * 0.62;



            context.beginPath();



            context.moveTo(particle.x, particle.y);



            context.lineTo(pointer.x, pointer.y);



            context.strokeStyle = `rgba(32, 79, 112, ${alpha})`;



            context.lineWidth = 1.1;



            context.stroke();



          }



        }



      }







      for (const particle of particles) {



        context.beginPath();



        context.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);



        context.fillStyle = particle.color;



        context.shadowColor = "rgba(125, 164, 192, 0.35)";



        context.shadowBlur = 6;



        context.fill();



      }







      context.shadowBlur = 0;



      animationFrame = window.requestAnimationFrame(draw);



    };







    const handlePointerMove = (event) => {



      const rect = canvas.getBoundingClientRect();



      pointer.x = event.clientX - rect.left;



      pointer.y = event.clientY - rect.top;



      pointer.active = pointer.x >= 0 && pointer.x <= rect.width && pointer.y >= 0 && pointer.y <= rect.height;



    };







    const handlePointerLeave = () => {



      pointer.active = false;



    };







    resize();



    draw();







    window.addEventListener("resize", resize);



    window.addEventListener("pointermove", handlePointerMove);



    window.addEventListener("pointerleave", handlePointerLeave);







    return () => {



      window.cancelAnimationFrame(animationFrame);



      window.removeEventListener("resize", resize);



      window.removeEventListener("pointermove", handlePointerMove);



      window.removeEventListener("pointerleave", handlePointerLeave);



    };



  }, []);







  return <canvas ref={canvasRef} className="kg-search-particles-canvas" aria-hidden="true" />;



}







export default function KnowledgeGraphSearchPage() {



  const [query, setQuery] = useState("");

  const [selectedSuggestion, setSelectedSuggestion] = useState(null);



  const [suggestions, setSuggestions] = useState([]);



  const [searchingSuggestions, setSearchingSuggestions] = useState(false);



  const [showNoSuggestions, setShowNoSuggestions] = useState(false);



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



  const searchFieldRef = useRef(null);

  const suppressNextSuggestionFetchRef = useRef(false);



  const showEvidenceMetrics = supportsEvidenceMetrics(result?.selected_node);







  useEffect(() => {



    const trimmed = query.trim();

    if (suppressNextSuggestionFetchRef.current) {

      suppressNextSuggestionFetchRef.current = false;

      return undefined;

    }



    if (!trimmed) {



      setSuggestions([]);



      setSearchingSuggestions(false);



      setShowNoSuggestions(false);



      return undefined;



    }







    const timer = setTimeout(async () => {



      setSearchingSuggestions(true);



      setShowNoSuggestions(false);



      try {



        const data = await api.searchKnowledgeGraphSuggestions(trimmed, "all");



        const nextSuggestions = Array.isArray(data) ? data : [];



        setSuggestions(nextSuggestions);



        setShowNoSuggestions(nextSuggestions.length === 0);



      } catch {



        setSuggestions([]);



        setShowNoSuggestions(true);



      } finally {



        setSearchingSuggestions(false);



      }



    }, 200);







    return () => clearTimeout(timer);



  }, [query]);







  useEffect(() => {



    const trimmed = query.trim();



    const isOpen = trimmed && (searchingSuggestions || showNoSuggestions || suggestions.length > 0);



    if (!isOpen) {



      return undefined;



    }







    const handlePointerDown = (event) => {



      if (!searchFieldRef.current?.contains(event.target)) {



        setSuggestions([]);



        setSearchingSuggestions(false);



        setShowNoSuggestions(false);



      }



    };







    document.addEventListener("mousedown", handlePointerDown);



    return () => document.removeEventListener("mousedown", handlePointerDown);



  }, [query, suggestions.length, searchingSuggestions, showNoSuggestions]);







  const handleSearch = async (event) => {



    event.preventDefault();



    const trimmed = query.trim();



    if (!trimmed) {



      return;



    }







    setStatus("loading");



    setError("");



    setSuggestions([]);



    setSearchingSuggestions(false);



    setShowNoSuggestions(false);



    setSelectedGraphItem(null);

    const searchTerm = selectedSuggestion?.primary_id || trimmed;







    try {



      const data = await api.searchKnowledgeGraph(searchTerm, "all");



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







  const handleNodeSearch = async (node) => {



    if (!node?.primary_id && !node?.name) {



      return;



    }







    const nextQuery = node.primary_id || node.name;

    const nextDisplayQuery = node.name || nextQuery;

    suppressNextSuggestionFetchRef.current = true;

    setSelectedSuggestion(null);



    setQuery(nextDisplayQuery);



    setSuggestions([]);



    setSearchingSuggestions(false);



    setShowNoSuggestions(false);



    setActiveTab("table");



    setSelectedGraphItem(null);



    setStatus("loading");



    setError("");







    try {



      const data = await api.searchKnowledgeGraph(nextQuery, "all");



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



    suppressNextSuggestionFetchRef.current = true;

    setSelectedSuggestion(item);

    setQuery(item.name || item.primary_id || "");



    setSuggestions([]);



    setSearchingSuggestions(false);



    setShowNoSuggestions(false);



  };







  return (



    <div className="page-stack kg-search-page">



      <section className={`kg-search-shell ${result?.selected_node ? "with-results" : ""}`}>



        <div className="kg-search-particles" aria-hidden="true">



          <ParticleBackground />



        </div>



        <div className="kg-search-shell-content">



          <div className="kg-search-hero-copy">



            <p className="eyebrow">Knowledge Graph Search</p>



          </div>







          <div className="kg-search-surface">



            <SearchControls



              query={query}



              setQuery={(value) => {

                setQuery(value);

                setSelectedSuggestion((current) => (current?.name === value ? current : null));

              }}



              onSubmit={handleSearch}



              loading={status === "loading"}



              suggestions={suggestions}



              searchingSuggestions={searchingSuggestions}



              showNoSuggestions={showNoSuggestions}



              onSelectSuggestion={handleSuggestionSelect}



              hasResult={Boolean(result?.selected_node)}



              searchFieldRef={searchFieldRef}



            />



            {error ? <div className="error-banner">{error}</div> : null}



            {status === "done" && result && !result.selected_node ? (



              <div className="empty-state kg-search-empty">No matches found for "{result.query}".</div>



            ) : null}



          </div>



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



        </SectionCard>



      ) : null}



    </div>



  );



}







