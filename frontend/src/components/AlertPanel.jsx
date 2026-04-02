import { useEffect, useState } from "react";
import { api } from "../lib/api";

function EmptyState({ message }) {
  return <div className="empty-state">{message}</div>;
}

function formatMetric(value) {
  if (value == null || value === "") {
    return "N/A";
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return String(value);
  }

  return numeric.toFixed(numeric >= 10 ? 1 : 3).replace(/\.0$/, "");
}

function selectTopConditions(items, limit = 2) {
  return [...(items || [])]
    .filter((item) => item?.condition_name && item?.prr != null)
    .sort((a, b) => Number(b.prr || 0) - Number(a.prr || 0))
    .slice(0, limit);
}

function joinIngredients(items) {
  const cleaned = (items || []).filter(Boolean);
  if (!cleaned.length) {
    return "";
  }
  if (cleaned.length === 1) {
    return cleaned[0];
  }
  if (cleaned.length === 2) {
    return `${cleaned[0]} and ${cleaned[1]}`;
  }
  return `${cleaned.slice(0, -1).join(", ")}, and ${cleaned.at(-1)}`;
}

function buildSummaryPayload(alert) {
  const evidencePayload = alert?.evidence_payload || {};
  const topConditions = selectTopConditions(evidencePayload.top_conditions || alert?.evidence || [], 3);

  if (!topConditions.length) {
    return null;
  }

  return {
    ...evidencePayload,
    drug_name:
      evidencePayload.drug_name ||
      alert?.new_drug_scd_name ||
      alert?.candidate_drug?.scd_name ||
      alert?.candidate_drug?.name ||
      alert?.new_drug_name,
    combination_ingredients:
      evidencePayload.combination_ingredients ||
      [alert?.new_drug_in_name || alert?.candidate_drug?.ingredient_name || alert?.new_drug_name].filter(Boolean),
    trigger_ingredient:
      evidencePayload.trigger_ingredient ||
      alert?.new_drug_in_name ||
      alert?.candidate_drug?.ingredient_name ||
      alert?.new_drug_name,
    current_medication:
      evidencePayload.current_medication ||
      alert?.active_medication_name ||
      alert?.active_drug?.medication_name ||
      alert?.active_drug?.name ||
      alert?.active_drug_name,
    top_conditions: topConditions,
  };
}

function buildFallbackSummaryMessage(payload) {
  if (!payload) {
    return "";
  }

  const lines = [];
  const combinationIngredients = (payload.combination_ingredients || []).filter(Boolean);

  if (combinationIngredients.length > 1) {
    lines.push(`The drug contains ${joinIngredients(combinationIngredients)}.`);
    lines.push(`${payload.trigger_ingredient} and ${payload.current_medication} have reported interaction signals.`);
  } else {
    lines.push(`${payload.drug_name || payload.trigger_ingredient} and ${payload.current_medication} have reported interaction signals.`);
  }

  if (payload.top_conditions?.length) {
    lines.push("");
    lines.push("Top conditions include:");
    payload.top_conditions.forEach((item) => {
      lines.push(`- ${item.display_text || item.condition_name}`);
    });
  }

  return lines.join("\n");
}

function parseSummaryMessage(message) {
  const rawLines = String(message || "")
    .replaceAll("\r", "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const lines = rawLines.length
    ? rawLines
    : String(message || "")
        .split(/(?<=[.!?])\s+/)
        .map((line) => line.trim())
        .filter(Boolean);

  const introLines = [];
  const conditionBullets = [];
  const notes = [];
  let readingConditions = false;

  lines.forEach((line) => {
    const normalized = line.trim();
    if (!normalized) {
      return;
    }

    if (/^Top conditions include:?$/i.test(normalized)) {
      readingConditions = true;
      return;
    }

    if (/^note:/i.test(normalized) || /(PRR|mean reporting frequency)/i.test(normalized)) {
      notes.push(normalized.replace(/^note:\s*/i, ""));
      return;
    }

    if (/^[-*]/.test(normalized)) {
      conditionBullets.push(normalized.replace(/^[-*]\s*/, ""));
      return;
    }

    if (readingConditions) {
      conditionBullets.push(normalized);
      return;
    }

    introLines.push(normalized);
  });

  return { introLines, conditionBullets, notes };
}

function GraphEvidenceCard({ alert, evidenceItems }) {
  const prescribingDrug =
    alert.new_drug_scd_name || alert.candidate_drug?.scd_name || alert.candidate_drug?.name || alert.new_drug_name;
  const prescribingIngredient =
    alert.new_drug_in_name || alert.candidate_drug?.ingredient_name || alert.new_drug_name;
  const activeDrug =
    alert.active_medication_name || alert.active_drug?.medication_name || alert.active_drug?.name || alert.active_drug_name;
  const activeIngredient =
    alert.active_drug_in_name || alert.active_drug?.ingredient_name || alert.active_drug_name;

  return (
    <section className="ddi-section-card kg-diagram-card">
      <div className="ddi-section-header">
        <h3>Knowledge Graph Evidence</h3>
        <p>Structured ingredient-level relation derived from the prescribing drug and the active drug.</p>
      </div>

      <div className="kg-diagram-grid">
        <div className="kg-diagram-top">
          <div className="kg-diagram-drug-box">
            <span>Prescribing Drug</span>
            <strong>{prescribingDrug || "N/A"}</strong>
          </div>
          <div className="kg-diagram-drug-box">
            <span>Active Drug</span>
            <strong>{activeDrug || "N/A"}</strong>
          </div>
        </div>

        <div className="kg-diagram-middle">
          <div className="kg-map-column">
            <div className="kg-vertical-line" />
            <span>contains</span>
            <div className="kg-arrow-down" />
          </div>
          <div className="kg-map-column">
            <div className="kg-vertical-line" />
            <span>contains</span>
            <div className="kg-arrow-down" />
          </div>
        </div>

        <div className="kg-diagram-bottom">
          <div className="kg-ingredient-box">
            <strong>{prescribingIngredient || "N/A"}</strong>
          </div>

          <div className="kg-signal-link">
            <div className="kg-signal-label kg-edge-chip" tabIndex={0}>
              <strong>{evidenceItems.length} DDI signal{evidenceItems.length === 1 ? "" : "s"}</strong>
              <div className="kg-edge-tooltip">
                <div className="kg-tooltip-header">Raw evidence</div>
                {evidenceItems.map((item, index) => (
                  <div key={`${item.condition_name || index}-${index}`} className="kg-tooltip-row">
                    <strong>{item.condition_name || "Unknown condition"}</strong>
                    <span>PRR: {formatMetric(item.prr)}</span>
                    <span>mean_reporting_frequency: {formatMetric(item.mean_reporting_frequency)}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="kg-horizontal-line" />
            <div className="kg-arrow-right" />
          </div>

          <div className="kg-ingredient-box">
            <strong>{activeIngredient || "N/A"}</strong>
          </div>
        </div>
      </div>
    </section>
  );
}

function AIClinicalSummary({ alert, alertKey }) {
  const [summary, setSummary] = useState({ introLines: [], conditionBullets: [], notes: [] });
  const [status, setStatus] = useState("idle");
  const promptPayload = buildSummaryPayload(alert);

  useEffect(() => {
    let cancelled = false;
    const currentPayload = buildSummaryPayload(alert);

    async function loadSummary() {
      if (!currentPayload) {
        setSummary({ introLines: [], conditionBullets: [], notes: [] });
        setStatus("done");
        return;
      }

      setStatus("loading");
      try {
        const data = await api.explainDdiAlert(currentPayload);
        const parsed = parseSummaryMessage(data.message || "");
        if (!cancelled) {
          setSummary(parsed);
          setStatus("done");
        }
      } catch {
        if (!cancelled) {
          setSummary(parseSummaryMessage(buildFallbackSummaryMessage(currentPayload)));
          setStatus("done");
        }
      }
    }

    loadSummary();

    return () => {
      cancelled = true;
    };
  }, [alertKey]);

  if (!promptPayload) {
    return (
      <section className="ddi-section-card ai-summary-card">
        <div className="ddi-section-header">
          <h3>AI Clinical Summary</h3>
        </div>
        <div className="ai-summary-copy">
          <p>No high-confidence evidence summary available.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="ddi-section-card ai-summary-card">
      <div className="ddi-section-header">
        <h3>AI Clinical Summary</h3>
      </div>
      <div className="ai-summary-copy">
        {summary.introLines.map((line, index) => (
          <p key={`${line}-${index}`}>{line}</p>
        ))}
        {summary.conditionBullets.length ? <p className="ai-summary-label">Top conditions include:</p> : null}
        {summary.conditionBullets.length ? (
          <ul className="ai-summary-list compact-bullets">
            {summary.conditionBullets.map((item, index) => (
              <li key={`${item}-${index}`}>{item}</li>
            ))}
          </ul>
        ) : null}
        {status === "loading" ? <small className="muted">Generating AI summary...</small> : null}
        {status !== "loading" && summary.notes.length ? (
          <div className="ai-summary-notes">
            {summary.notes.map((item, index) => (
              <small key={`${item}-${index}`}>{item}</small>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function DDIAlertList({ items, emptyMessage }) {
  if (!items?.length) {
    return <EmptyState message={emptyMessage} />;
  }

  return (
    <div className="stack">
      {items.map((alert, index) => {
        const alertKey = `${alert.new_drug_rxcui || "new"}-${alert.active_drug_rxcui || "active"}-${index}`;
        const evidenceItems = alert.evidence_payload?.top_conditions || alert.evidence || [];

        return (
          <div key={alertKey} className="alert-item high ddi-alert-item ddi-two-section-card">
            <GraphEvidenceCard alert={alert} evidenceItems={evidenceItems} />
            <AIClinicalSummary alert={alert} alertKey={alertKey} />
          </div>
        );
      })}
    </div>
  );
}

function DrugDiseaseSummaryCard({ alert }) {
  const candidateName = alert.candidate_drug?.name || alert.new_drug_name || `RxCUI ${alert.new_drug_rxcui}`;
  const diseaseName = alert.disease_name || "Unknown condition";
  const isContra = alert.type === "CONTRAINDICATION";
  const relationLabel = isContra ? "contraindication" : "off-label use";

  return (
    <div className={`alert-item ${isContra ? "high" : "moderate"}`}>
      <p>
        The patient currently has <strong>{diseaseName}</strong> as an active condition. <strong>{candidateName}</strong>
        {` has a `}
        <strong>{relationLabel}</strong>
        {` link with ${diseaseName} in the knowledge graph.`}
      </p>
    </div>
  );
}

function GenericAlertList({ items, emptyMessage }) {
  if (!items?.length) {
    return <EmptyState message={emptyMessage} />;
  }

  return (
    <div className="stack">
      {items.map((alert, index) => (
        <DrugDiseaseSummaryCard key={`${alert.type || alert.new_drug_rxcui || index}-${index}`} alert={alert} />
      ))}
    </div>
  );
}

export default function AlertPanel({ result }) {
  const ddiRules = result?.appliedRules?.ddi;
  const drugDiseaseRules = result?.appliedRules?.drug_disease;
  const ddiEmptyMessage = ddiRules?.enabled
    ? "No DDI alerts returned for the current check."
    : "DDI check was skipped because DDI strictness is off.";
  const drugDiseaseEmptyMessage =
    drugDiseaseRules?.strictness === "off"
      ? "Drug-disease checks were skipped by the current rule configuration."
      : result?.drug_disease_module?.message || "No drug-disease results returned for the current check.";

  return (
    <div className="alert-grid single-column-alerts">
      <div className="card alert-card">
        <div className="section-header">
          <div>
            <h2>Drug-Drug Interaction Alerts</h2>
            <p>Structured graph evidence with a separate AI-generated clinical summary.</p>
          </div>
        </div>
        <DDIAlertList items={result?.ddi_alerts || []} emptyMessage={ddiEmptyMessage} />
      </div>

      <div className="card alert-card">
        <div className="section-header">
          <div>
            <h2>Drug-Disease Results</h2>
            <p>Contraindications block prescribing; off-label links are informational</p>
          </div>
        </div>
        <GenericAlertList
          items={[...(result?.drug_disease_alerts || []), ...(result?.drug_disease_references || [])]}
          emptyMessage={drugDiseaseEmptyMessage}
        />
      </div>
    </div>
  );
}
