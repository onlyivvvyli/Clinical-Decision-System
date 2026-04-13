import { useEffect, useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import AlertPanel from "../components/AlertPanel";
import PrescribeForm from "../components/PrescribeForm";
import SectionCard from "../components/SectionCard";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/api";

function DataList({ items, columns, emptyMessage, pageSize = 4 }) {
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pagedItems = items.slice((safePage - 1) * pageSize, safePage * pageSize);

  useEffect(() => {
    setPage(1);
  }, [items.length, pageSize]);

  return (
    <div className="section-content-stack">
      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.key}>{column.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.length ? (
              pagedItems.map((item, index) => (
                <tr key={item.id || `${item.code}-${index}`}>
                  {columns.map((column) => (
                    <td key={column.key}>{item[column.key] || "N/A"}</td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={columns.length} className="empty-cell">
                  {emptyMessage}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {items.length > pageSize ? (
        <div className="pagination-bar">
          <span className="pagination-copy">
            Page {safePage} / {totalPages}
          </span>
          <div className="pagination-actions">
            <button
              type="button"
              className="ghost-button"
              disabled={safePage === 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              Previous
            </button>
            <button
              type="button"
              className="ghost-button"
              disabled={safePage === totalPages}
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
            >
              Next
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function LoadingBlock({ message = "Loading patient details..." }) {
  return (
    <div className="patient-loading-state" aria-live="polite">
      <div className="loading-dots" aria-hidden="true">
        <span></span>
        <span></span>
        <span></span>
      </div>
      <p>{message}</p>
    </div>
  );
}

function summarizeReviewCard(result) {
  const ddiCount = result?.ddi_alerts?.length || 0;
  const drugDiseaseCount = (result?.drug_disease_alerts?.length || 0) + (result?.drug_disease_references?.length || 0);
  const total = ddiCount + drugDiseaseCount;

  if (!total) {
    return {
      headline: "No clinically relevant risks require review.",
      detail: "The medication review completed without DDI or drug-disease findings requiring extra review.",
      total,
    };
  }

  return {
    headline: `${total} clinically relevant risk${total === 1 ? "" : "s"} require review.`,
    detail: `${ddiCount} DDI and ${drugDiseaseCount} Drug-Disease finding${drugDiseaseCount === 1 ? "" : "s"}.`,
    total,
  };
}

export default function PatientDetailPage() {
  const { id } = useParams();
  const location = useLocation();
  const { doctor } = useAuth();
  const previewPatient = location.state?.patient || null;
  const [summary, setSummary] = useState(null);
  const [result, setResult] = useState(null);
  const [pendingPayload, setPendingPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [workflowMessage, setWorkflowMessage] = useState("");
  const [showPrescribeModal, setShowPrescribeModal] = useState(false);
  const [showCheckPrompt, setShowCheckPrompt] = useState(false);
  const [showCheckDetails, setShowCheckDetails] = useState(false);
  const [expandedSections, setExpandedSections] = useState({
    basic: true,
    conditions: true,
    medications: true,
    history: false,
  });
  const [conditionStatusFilter, setConditionStatusFilter] = useState("all");

  const loadSummary = () => {
    setLoading(true);
    setError("");
    api
      .getPatientSummary(id)
      .then(setSummary)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    setSummary(null);
    setResult(null);
    setPendingPayload(null);
    setWorkflowMessage("");
    setShowPrescribeModal(false);
    setShowCheckPrompt(false);
    setShowCheckDetails(false);
    loadSummary();
  }, [id]);

  const toggleSection = (key, nextValue) => {
    setExpandedSections((current) => ({
      ...current,
      [key]: nextValue,
    }));
  };

  const startWorkflow = (payload) => {
    setPendingPayload(payload);
    setShowCheckPrompt(true);
    setShowCheckDetails(false);
    setShowPrescribeModal(false);
    setWorkflowMessage("");
    setResult(null);
  };

  const shouldBypassReview = (payload) => (
    payload?.ddiStrictness === "off" && payload?.drugDiseaseStrictness === "off"
  );

  const handleSubmit = async (payload) => {
    if (!payload) {
      return;
    }

    setBusy(true);
    setError("");
    setWorkflowMessage("");

    if (shouldBypassReview(payload)) {
      setShowPrescribeModal(false);
      try {
        const data = await api.submitPrescription(payload);
        setPendingPayload(null);
        setResult(null);
        setWorkflowMessage(data.message || "Prescription submitted.");
        loadSummary();
      } catch (err) {
        setError(err.message);
        setShowPrescribeModal(true);
      } finally {
        setBusy(false);
      }
      return;
    }

    startWorkflow(payload);
    try {
      const data = await api.checkPrescription(payload);
      setResult(data);
    } catch (err) {
      setError(err.message);
      setShowPrescribeModal(true);
    } finally {
      setBusy(false);
    }
  };

  const handleContinuePrescribe = async () => {
    if (!pendingPayload || !result) {
      return;
    }

    setBusy(true);
    setError("");
    try {
      const data = await api.submitPrescription(pendingPayload);
      setWorkflowMessage(data.message || "Prescription submitted.");
      setResult(null);
      setPendingPayload(null);
      setShowCheckPrompt(false);
      setShowCheckDetails(false);
      loadSummary();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleBackToPrescribe = () => {
    setShowCheckPrompt(false);
    setShowCheckDetails(false);
    setShowPrescribeModal(true);
  };

  const handleAbandonPrescription = () => {
    setPendingPayload(null);
    setResult(null);
    setError("");
    setShowCheckPrompt(false);
    setShowCheckDetails(false);
    setWorkflowMessage("Prescription review was dismissed without changing the current medication list.");
  };

  const patientHeader = summary?.patient || previewPatient || {
    id,
    name: `Patient ${id}`,
    gender: "Unknown",
    birth_date: "",
    age: "Unknown",
  };
  const currentConditions = summary?.current_conditions || [];
  const currentMedications = summary?.current_medications || [];
  const medicationHistory = summary?.medication_history || [];
  const filteredConditions = currentConditions.filter((condition) => (
    conditionStatusFilter === "all" || String(condition.clinical_status || "").trim().toLowerCase() === conditionStatusFilter
  ));
  const reviewSummary = summarizeReviewCard(result);

  return (
    <div className="page-stack">
      <section className="hero-banner patient-hero compact">
        <div>
          <p className="eyebrow">Patient Detail</p>
          <h1>{patientHeader.name}</h1>
          <p>
            {patientHeader.id} | {patientHeader.gender} | DOB {patientHeader.birth_date || "N/A"} | Age {patientHeader.age}
          </p>
        </div>
        <div className="hero-metrics">
          <div className="status-panel">
            <span className="label">Current meds</span>
            <strong>{loading && !summary ? "..." : currentMedications.length}</strong>
          </div>
          <div className="status-panel">
            <span className="label">Active conditions</span>
            <strong>{loading && !summary ? "..." : currentConditions.length}</strong>
          </div>
        </div>
      </section>

      {workflowMessage ? <div className="result-banner approved">{workflowMessage}</div> : null}
      {error && !summary ? <div className="error-banner">{error}</div> : null}
      {error && summary ? <div className="error-banner">{error}</div> : null}

      <div className="patient-sections">
        <SectionCard
          title="Basic Info"
          subtitle="FHIR Patient resource summary"
          collapsible
          expanded={expandedSections.basic}
          onToggle={(nextValue) => toggleSection("basic", nextValue)}
        >
          <div className="kv-grid">
            <div><span>Patient ID</span><strong>{patientHeader.id}</strong></div>
            <div><span>Name</span><strong>{patientHeader.name}</strong></div>
            <div><span>Gender</span><strong>{patientHeader.gender}</strong></div>
            <div><span>Birth Date</span><strong>{patientHeader.birth_date || "N/A"}</strong></div>
            <div><span>Age</span><strong>{patientHeader.age}</strong></div>
          </div>
        </SectionCard>

        <SectionCard
          title="Current Conditions"
          subtitle="FHIR Condition resources"
          collapsible
          expanded={expandedSections.conditions}
          onToggle={(nextValue) => toggleSection("conditions", nextValue)}
        >
          {loading && !summary ? (
            <LoadingBlock message="Loading current conditions..." />
          ) : (
            <>
              <div className="section-filter-row">
                <label className="table-filter">
                  <span>Status</span>
                  <select value={conditionStatusFilter} onChange={(event) => setConditionStatusFilter(event.target.value)}>
                    <option value="all">All</option>
                    <option value="active">Active</option>
                    <option value="resolved">Resolved</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </label>
              </div>
              <DataList
                items={filteredConditions}
                columns={[
                  { key: "name", label: "Condition" },
                  { key: "code", label: "Code" },
                  { key: "clinical_status", label: "Clinical Status" },
                  { key: "onset_date", label: "Onset Date" },
                ]}
                emptyMessage="No conditions available for the selected status."
              />
            </>
          )}
        </SectionCard>

        <SectionCard
          title="Current Medications"
          subtitle="Current active medications are resolved to ingredients before DDI checks"
          collapsible
          expanded={expandedSections.medications}
          onToggle={(nextValue) => toggleSection("medications", nextValue)}
          actions={
            <button type="button" className="icon-action" onClick={() => setShowPrescribeModal(true)} aria-label="Prescribe new medication">
              <span>Prescribe</span>
              <strong>+</strong>
            </button>
          }
        >
          {loading && !summary ? (
            <LoadingBlock message="Loading current medications..." />
          ) : (
            <DataList
              items={currentMedications}
              columns={[
                { key: "name", label: "Medication" },
                { key: "code", label: "Code" },
                { key: "status", label: "Status" },
                { key: "authored_on", label: "Authored On" },
                { key: "dosage_text", label: "Dosage" },
              ]}
              emptyMessage="No current medications available."
            />
          )}
        </SectionCard>

        <SectionCard
          title="Medication History"
          subtitle="Displayed for context only; not part of blocking logic in this MVP"
          collapsible
          expanded={expandedSections.history}
          onToggle={(nextValue) => toggleSection("history", nextValue)}
        >
          {loading && !summary ? (
            <LoadingBlock message="Loading medication history..." />
          ) : (
            <DataList
              items={medicationHistory}
              columns={[
                { key: "name", label: "Medication" },
                { key: "status", label: "Status" },
                { key: "authored_on", label: "Authored On" },
                { key: "period", label: "Relevant Period" },
              ]}
              emptyMessage="No historical medications available."
            />
          )}
        </SectionCard>
      </div>

      {showPrescribeModal ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card">
            <div className="section-header">
              <div>
                <p className="eyebrow">New Order</p>
                <h2>Prescribe Medication</h2>
              </div>
              <button
                type="button"
                className="icon-action close-action"
                onClick={() => setShowPrescribeModal(false)}
                aria-label="Close prescribe dialog"
              >
                <strong>x</strong>
              </button>
            </div>
            <PrescribeForm
              patientId={id}
              doctorId={doctor.id}
              onSubmit={handleSubmit}
              busy={busy}
              initialValues={pendingPayload}
            />
          </div>
        </div>
      ) : null}

      {showCheckPrompt ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card safety-check-prompt-card">
            <div className="safety-check-prompt-copy">
              <p className="eyebrow neutral">Clinical Safety Checking</p>
              <h2>{busy && !result ? "Running medication review" : reviewSummary.headline}</h2>
              <p>{busy && !result ? "Please wait while the system completes the medication review." : reviewSummary.detail}</p>
            </div>
            <div className="safety-check-prompt-actions">
              <button
                type="button"
                className="ghost-button"
                onClick={handleBackToPrescribe}
                disabled={busy}
              >
                Back to Prescribe
              </button>
              <button
                type="button"
                className="ghost-button"
                onClick={handleAbandonPrescription}
                disabled={busy}
              >
                Abandon Prescription
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={() => {
                  setShowCheckPrompt(false);
                  setShowCheckDetails(true);
                }}
                disabled={busy || !result}
              >
                Show Details
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showCheckDetails ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card check-modal-card detail-modal-card">
            <div className="detail-modal-top">
              <div className="section-header check-modal-header sticky-check-header">
                <div>
                  <p className="eyebrow neutral">Safety Check Details</p>
                  <h2>Clinical Safety Review</h2>
                  <p>Review the findings in detail before deciding whether to continue the prescription.</p>
                </div>
                <button
                  type="button"
                  className="icon-action close-action"
                  onClick={() => {
                    setShowCheckDetails(false);
                    setShowCheckPrompt(true);
                  }}
                  aria-label="Close safety check details"
                >
                  <strong>x</strong>
                </button>
              </div>

              {!busy && result ? (
                <div className="decision-actions sticky-check-actions">
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={handleBackToPrescribe}
                    disabled={busy}
                  >
                    Back to Prescribe
                  </button>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={handleAbandonPrescription}
                    disabled={busy}
                  >
                    Abandon Prescription
                  </button>
                  <button
                    type="button"
                    className="primary-button"
                    onClick={handleContinuePrescribe}
                    disabled={busy}
                  >
                    Continue Prescribe
                  </button>
                </div>
              ) : null}
            </div>

            {!busy && result ? (
              <div className="check-modal-results detail-modal-scroll-body">
                <AlertPanel result={result} />
              </div>
            ) : null}

            {!busy && error && !result ? <div className="error-banner">{error}</div> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
