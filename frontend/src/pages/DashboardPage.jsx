import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import SectionCard from "../components/SectionCard";
import SummaryCard from "../components/SummaryCard";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/api";

function formatStrictness(value) {
  return String(value || "unknown").replaceAll("_", " ");
}

const PATIENT_LIST_CACHE_KEY = "patient-list-cache-v1";

function readCachedPatientCount() {
  try {
    const raw = sessionStorage.getItem(PATIENT_LIST_CACHE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.length : null;
  } catch {
    return null;
  }
}

export default function DashboardPage() {
  const { doctor, safetySettings } = useAuth();
  const [patientCount, setPatientCount] = useState(() => readCachedPatientCount());
  const [alerts, setAlerts] = useState([]);

  useEffect(() => {
    api.getPatients().then((data) => setPatientCount(data.length)).catch(() => setPatientCount((current) => current ?? null));
    api.getAlerts().then(setAlerts).catch(() => setAlerts([]));
  }, []);

  return (
    <div className="page-stack">
      <section className="hero-banner">
        <div>
          <p className="eyebrow">Dashboard</p>
          <h1>Welcome back, {doctor?.name}</h1>
          <p>Monitor prescribing activity, review recent alerts, and enter the patient workflow.</p>
        </div>
        <div className="dashboard-hero-actions">
          <Link className="ghost-button" to="/settings">
            Clinical Safety Settings
          </Link>
          <Link className="primary-button" to="/patients">
            Enter Patient List
          </Link>
        </div>
      </section>

      <div className="summary-grid">
        <SummaryCard label="Patients" value={patientCount ?? "..."} hint="Available from FHIR Patient resources" />
        <SummaryCard label="Recent Alerts" value={alerts.length} hint="Last 20 prescription log records" />
        <SummaryCard label="DDI Default" value={formatStrictness(safetySettings.ddiStrictness)} hint="Auto-applied to all later prescription checks" />
      </div>

      <SectionCard
        title="Clinical Safety Settings Snapshot"
        subtitle="Current defaults that will automatically apply to all subsequent risk checks and prescription submissions"
        actions={
          <Link className="inline-link" to="/settings">
            Open Settings Dashboard
          </Link>
        }
      >
        <div className="kv-grid settings-kv-grid">
          <div>
            <span>DDI strictness</span>
            <strong>{formatStrictness(safetySettings.ddiStrictness)}</strong>
          </div>
          <div>
            <span>Drug-disease strictness</span>
            <strong>{formatStrictness(safetySettings.drugDiseaseStrictness)}</strong>
          </div>
          <div>
            <span>Application behavior</span>
            <strong>Auto apply to all future checks</strong>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Recent Prescription Activity" subtitle="Local SQLite-backed submission log">
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Patient</th>
                <th>Medication</th>
                <th>Decision</th>
                <th>Created At</th>
              </tr>
            </thead>
            <tbody>
              {alerts.length ? (
                alerts.slice(0, 5).map((log) => (
                  <tr key={log.id}>
                    <td>{log.patient_id}</td>
                    <td>{log.medication_name}</td>
                    <td>
                      <span className={`pill ${log.decision}`}>{log.decision}</span>
                    </td>
                    <td>{new Date(log.created_at).toLocaleString()}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="4" className="empty-cell">
                    No submission logs yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}
