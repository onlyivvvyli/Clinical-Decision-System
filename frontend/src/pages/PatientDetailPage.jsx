import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
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

export default function PatientDetailPage() {
  const { id } = useParams();
  const { doctor } = useAuth();
  const [summary, setSummary] = useState(null);
  const [result, setResult] = useState(null);
  const [pendingPayload, setPendingPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showPrescribeModal, setShowPrescribeModal] = useState(false);
  const [showCheckModal, setShowCheckModal] = useState(false);
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
    setShowCheckModal(true);
    setShowPrescribeModal(false);
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

    if (shouldBypassReview(payload)) {
      setShowPrescribeModal(false);
      try {
        await api.submitPrescription(payload);
        setPendingPayload(null);
        setResult(null);
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
      setResult(data);
      setPendingPayload(null);
      setShowCheckModal(false);
      loadSummary();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };


  const handleBackToPrescribe = () => {
    setShowCheckModal(false);
    setShowPrescribeModal(true);
  };

  const handleAbandonPrescription = () => {
    setPendingPayload(null);
    setResult(null);
    setError("");
    setShowCheckModal(false);
  };

  if (loading) {
    return <div className="empty-state">Loading patient summary...</div>;
  }

  if (error && !summary) {
    return <div className="error-banner">{error}</div>;
  }

  const filteredConditions = summary.current_conditions.filter((condition) => (
    conditionStatusFilter === "all" || String(condition.clinical_status || "").trim().toLowerCase() === conditionStatusFilter
  ));

  return (
    <div className="page-stack">
      <section className="hero-banner patient-hero compact">
        <div>
          <p className="eyebrow">Patient Detail</p>
          <h1>{summary.patient.name}</h1>
          <p>
            {summary.patient.id} | {summary.patient.gender} | DOB {summary.patient.birth_date || "N/A"} | Age {summary.patient.age}
          </p>
        </div>
        <div className="hero-metrics">
          <div className="status-panel">
            <span className="label">Current meds</span>
            <strong>{summary.current_medications.length}</strong>
          </div>
          <div className="status-panel">
            <span className="label">Active conditions</span>
            <strong>{summary.current_conditions.length}</strong>
          </div>
        </div>
      </section>

      {error ? <div className="error-banner">{error}</div> : null}

      <div className="patient-sections">
        <SectionCard
          title="Basic Info"
          subtitle="FHIR Patient resource summary"
          collapsible
          expanded={expandedSections.basic}
          onToggle={(nextValue) => toggleSection("basic", nextValue)}
        >
          <div className="kv-grid">
            <div><span>Patient ID</span><strong>{summary.patient.id}</strong></div>
            <div><span>Name</span><strong>{summary.patient.name}</strong></div>
            <div><span>Gender</span><strong>{summary.patient.gender}</strong></div>
            <div><span>Birth Date</span><strong>{summary.patient.birth_date || "N/A"}</strong></div>
            <div><span>Age</span><strong>{summary.patient.age}</strong></div>
          </div>
        </SectionCard>

        <SectionCard
          title="Current Conditions"
          subtitle="FHIR Condition resources"
          collapsible
          expanded={expandedSections.conditions}
          onToggle={(nextValue) => toggleSection("conditions", nextValue)}
        >
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
          <DataList
            items={summary.current_medications}
            columns={[
              { key: "name", label: "Medication" },
              { key: "code", label: "Code" },
              { key: "status", label: "Status" },
              { key: "authored_on", label: "Authored On" },
              { key: "dosage_text", label: "Dosage" },
            ]}
            emptyMessage="No current medications available."
          />
        </SectionCard>

        <SectionCard
          title="Medication History"
          subtitle="Displayed for context only; not part of blocking logic in this MVP"
          collapsible
          expanded={expandedSections.history}
          onToggle={(nextValue) => toggleSection("history", nextValue)}
        >
          <DataList
            items={summary.medication_history}
            columns={[
              { key: "name", label: "Medication" },
              { key: "status", label: "Status" },
              { key: "authored_on", label: "Authored On" },
              { key: "period", label: "Relevant Period" },
            ]}
            emptyMessage="No historical medications available."
          />
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

      {showCheckModal ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card check-modal-card">
            <div className="section-header check-modal-header">
              <div>
                <p className="eyebrow">Safety Check</p>
                <h2>{busy ? "Running medication review" : result ? "Review complete" : "Review status"}</h2>
                <p>The safety check is triggered automatically when the doctor submits. After the review, the doctor can abandon the order or continue prescribing to add it to the patient's medication list.</p>
              </div>
              <button
                type="button"
                className="icon-action close-action"
                onClick={handleAbandonPrescription}
                aria-label="Close safety check dialog"
                disabled={busy}
              >
                <strong>x</strong>
              </button>
            </div>

            {busy ? (
              <div className="check-loading-state" aria-live="polite">
                <div className="loading-dots" aria-hidden="true">
                  <span></span>
                  <span></span>
                  <span></span>
                </div>
                <p>Loading...</p>
              </div>
            ) : null}

            {!busy && result ? (
              <div className="check-modal-results">
                <div className="decision-actions">
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





