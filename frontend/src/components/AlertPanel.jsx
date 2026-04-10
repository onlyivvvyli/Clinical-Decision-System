import { useEffect, useMemo, useState } from "react";
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

function renderHighlightedDrugLine(line, alert) {
  const text = String(line || "");
  const tokens = [
    alert?.new_drug_scd_name,
    alert?.new_drug_name,
    alert?.active_medication_name,
    alert?.active_drug_name,
  ]
    .filter(Boolean)
    .map((item) => String(item).trim())
    .filter(Boolean);

  if (!text || !tokens.length) {
    return text;
  }

  const uniqueTokens = [...new Set(tokens)].sort((a, b) => b.length - a.length);
  const lowerText = text.toLowerCase();
  const matches = [];

  uniqueTokens.forEach((token) => {
    const lowerToken = token.toLowerCase();
    let startIndex = 0;

    while (startIndex < lowerText.length) {
      const foundAt = lowerText.indexOf(lowerToken, startIndex);
      if (foundAt === -1) {
        break;
      }

      matches.push({
        start: foundAt,
        end: foundAt + token.length,
      });
      startIndex = foundAt + token.length;
    }
  });

  matches.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));

  const merged = [];
  matches.forEach((match) => {
    const overlaps = merged.some((item) => !(match.end <= item.start || match.start >= item.end));
    if (!overlaps) {
      merged.push(match);
    }
  });

  if (!merged.length) {
    return text;
  }

  const nodes = [];
  let cursor = 0;

  merged.forEach((match, index) => {
    if (cursor < match.start) {
      nodes.push(<span key={`text-${index}-${cursor}`}>{text.slice(cursor, match.start)}</span>);
    }

    nodes.push(
      <strong key={`drug-${index}-${match.start}`} className="drug-highlight">
        {text.slice(match.start, match.end)}
      </strong>,
    );
    cursor = match.end;
  });

  if (cursor < text.length) {
    nodes.push(<span key={`text-tail-${cursor}`}>{text.slice(cursor)}</span>);
  }

  return nodes;
}

function classifyDrugDiseaseSeverity(type) {
  return type === "CONTRAINDICATION" ? "high" : "moderate";
}

function formatStrictness(value) {
  if (!value) {
    return "N/A";
  }

  const normalized = String(value).replaceAll("_", " ");
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function summarizeRiskCounts(result) {
  const ddiCount = result?.ddi_alerts?.length || 0;
  const drugDiseaseCount = (result?.drug_disease_alerts?.length || 0) + (result?.drug_disease_references?.length || 0);
  const total = ddiCount + drugDiseaseCount;

  const primaryObjects = [];
  const firstDdi = result?.ddi_alerts?.[0];
  const firstDrugDisease = result?.drug_disease_alerts?.[0] || result?.drug_disease_references?.[0];

  if (firstDdi) {
    const trigger = firstDdi.new_drug_in_name || firstDdi.new_drug_name || "Selected drug";
    const active = firstDdi.active_medication_name || firstDdi.active_drug_name || "current medication";
    primaryObjects.push(`${trigger} and ${active}`);
  }
  if (firstDrugDisease) {
    const triggerDrug = firstDrugDisease.new_drug_name || "Selected drug";
    const disease = firstDrugDisease.disease_name || "active condition";
    primaryObjects.push(`${triggerDrug} and ${disease}`);
  }

  if (!total) {
    return {
      total,
      ddiCount,
      drugDiseaseCount,
      headline: "No clinically significant risks were returned for this review.",
      summary: "No DDI or drug-disease findings require immediate review.",
    };
  }

  const plural = total === 1 ? "risk" : "risks";
  const objectSummary = primaryObjects.length ? ` involving ${primaryObjects.join("; ")}` : "";

  return {
    total,
    ddiCount,
    drugDiseaseCount,
    headline: `${total} clinically relevant ${plural} require review${objectSummary}.`,
    summary: `${ddiCount} DDI finding${ddiCount === 1 ? "" : "s"} and ${drugDiseaseCount} Drug-Disease finding${drugDiseaseCount === 1 ? "" : "s"}.`,
  };
}

function groupDrugDiseaseItems(items) {
  const grouped = new Map();

  (items || []).forEach((item) => {
    const drugName = item.new_drug_name || `RxCUI ${item.new_drug_rxcui || "Unknown"}`;
    const key = `${item.type || "Drug-Disease"}-${drugName}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        key,
        type: item.type || "Drug-Disease",
        drugName,
        items: [],
      });
    }
    grouped.get(key).items.push(item);
  });

  return [...grouped.values()];
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

function DrugDiseaseEvidenceCard({ item }) {
  const drugName = item.new_drug_name || `RxCUI ${item.new_drug_rxcui || "Unknown"}`;
  const diseaseName = item.disease_name || "Unknown condition";
  const relationLabel = item.type === "CONTRAINDICATION" ? "contraindication" : "off-label use";

  return (
    <section className="ddi-section-card disease-evidence-card">
      <div className="ddi-section-header">
        <h3>Knowledge Graph Evidence</h3>
        <p>Active disease match from the current clinical context.</p>
      </div>

      <div className="disease-kg-grid">
        <div className="disease-kg-node">
          <span>Drug</span>
          <strong>{drugName}</strong>
        </div>
        <div className="disease-kg-link">
          <div className="kg-vertical-line" />
          <div className="kg-edge-chip disease-relation-chip">
            <strong>{relationLabel}</strong>
          </div>
          <div className="kg-arrow-down" />
        </div>
        <div className="disease-kg-node condition-node">
          <span>Active Disease</span>
          <strong>{diseaseName}</strong>
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
  }, [alert, alertKey]);

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
          <p key={`${line}-${index}`} className="ai-summary-intro">{renderHighlightedDrugLine(line, alert)}</p>
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

function AlertTag({ children, tone = "neutral" }) {
  return <span className={`alert-tag ${tone}`}>{children}</span>;
}

function DdiRiskCard({ alert, index }) {
  const alertKey = `${alert.new_drug_rxcui || "new"}-${alert.active_drug_rxcui || "active"}-${index}`;
  const evidenceItems = alert.evidence_payload?.top_conditions || alert.evidence || [];
  const triggerDrug = alert.new_drug_scd_name || alert.new_drug_name || "Selected drug";
  const activeDrug = alert.active_medication_name || alert.active_drug_name || "Current medication";

  return (
    <article className="risk-item-card">
      <div className="ddi-page-stack">
        <section className="ddi-slide-panel">
          <div className="ddi-content-slide-header">
            <strong>AI Clinical Summary</strong>
          </div>
          <AIClinicalSummary alert={alert} alertKey={alertKey} />
        </section>

        <section className="ddi-slide-panel">
          <div className="ddi-content-slide-header">
            <strong>KG Evidence</strong>
          </div>
          <GraphEvidenceCard alert={alert} evidenceItems={evidenceItems} />
        </section>
      </div>
    </article>
  );
}

function DrugDiseaseGroupCard({ group }) {
  return (
    <article className="risk-item-card drug-disease-card simple-drug-disease-card">
      <div className="drug-disease-sentence-list">
        {group.items.map((item, index) => {
          const drugName = item.new_drug_name || group.drugName || "This drug";
          const diseaseName = item.disease_name || "the current disease";
          const relationText = item.type === "CONTRAINDICATION"
            ? "is contraindicated for"
            : "is off-label use for";

          return (
            <p key={`${group.key}-${item.disease_id || index}`} className="drug-disease-sentence">
              <strong>{drugName}</strong> {relationText} <strong>{diseaseName}</strong>.
            </p>
          );
        })}
      </div>
    </article>
  );
}

function RiskSection({ title, subtitle, items, emptyMessage, renderItem }) {
  const useCarousel = items.length > 1;
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    setActiveIndex(0);
  }, [items.length, title]);

  const showPrevious = () => {
    setActiveIndex((current) => (current - 1 + items.length) % items.length);
  };

  const showNext = () => {
    setActiveIndex((current) => (current + 1) % items.length);
  };

  return (
    <section className="review-section">
      <div className="review-section-header">
        <div>
          <h2>{title}</h2>
        </div>
      </div>

      {items.length ? (
        useCarousel ? (
          <div className="risk-carousel-shell">
            <button type="button" className="risk-carousel-arrow left" onClick={showPrevious} aria-label={`Previous ${title} item`}>
              {'<'}
            </button>
            <div className="risk-carousel-stage">
              <div className="risk-carousel-track" style={{ transform: `translateX(-${activeIndex * 100}%)` }}>
                {items.map((item, index) => (
                  <div key={item.key || `${title}-${index}`} className="risk-carousel-slide">
                    {renderItem(item, index)}
                  </div>
                ))}
              </div>
            </div>
            <button type="button" className="risk-carousel-arrow right" onClick={showNext} aria-label={`Next ${title} item`}>
              {'>'}
            </button>
            <div className="risk-carousel-dots" role="tablist" aria-label={`${title} pages`}>
              {items.map((item, index) => (
                <button
                  key={`${item.key || title}-dot-${index}`}
                  type="button"
                  className={index === activeIndex ? "risk-carousel-dot active" : "risk-carousel-dot"}
                  onClick={() => setActiveIndex(index)}
                  aria-label={`${title} item ${index + 1}`}
                  aria-pressed={index === activeIndex}
                />
              ))}
            </div>
          </div>
        ) : (
          <div className="stack risk-list">
            {items.map((item, index) => (
              <div key={item.key || `${title}-${index}`} className="risk-list-item">
                {renderItem(item, index)}
              </div>
            ))}
          </div>
        )
      ) : (
        <EmptyState message={emptyMessage} />
      )}
    </section>
  );
}

export default function AlertPanel({ result }) {
  const ddiRules = result?.appliedRules?.ddi;
  const drugDiseaseRules = result?.appliedRules?.drug_disease;
  const ddiItems = result?.ddi_alerts || [];
  const drugDiseaseItems = useMemo(
    () => groupDrugDiseaseItems([...(result?.drug_disease_alerts || []), ...(result?.drug_disease_references || [])]),
    [result],
  );
  const totals = summarizeRiskCounts(result);
  const ddiEmptyMessage = ddiRules?.enabled
    ? "No DDI alerts returned for the current check."
    : "DDI check was skipped because DDI strictness is off.";
  const drugDiseaseEmptyMessage =
    drugDiseaseRules?.strictness === "off"
      ? "Drug-disease checks were skipped by the current rule configuration."
      : result?.drug_disease_module?.message || "No drug-disease results returned for the current check.";

  return (
    <div className="safety-review-layout">
      <div className="safety-review-main">
        <section className="review-summary-card compact-review-summary-card">
          <div className="review-summary-copy compact-review-summary-copy">
            <h2>{totals.ddiCount} DDI findings and {totals.drugDiseaseCount} Drug-Disease findings.</h2>
          </div>
        </section>

        <RiskSection
          title="DDI Findings"
          subtitle="Review drug-drug interaction findings first."
          items={ddiItems}
          emptyMessage={ddiEmptyMessage}
          renderItem={(item, index) => <DdiRiskCard key={`${item.new_drug_rxcui || index}-${item.active_drug_rxcui || index}`} alert={item} index={index} />}
        />

        <RiskSection
          title="Drug-Disease Findings"
          subtitle="Disease-related findings are grouped by drug and expanded by active disease."
          items={drugDiseaseItems}
          emptyMessage={drugDiseaseEmptyMessage}
          renderItem={(item) => <DrugDiseaseGroupCard key={item.key} group={item} />}
        />
      </div>
    </div>
  );
}
