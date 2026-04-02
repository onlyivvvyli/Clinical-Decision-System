import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import SectionCard from "../components/SectionCard";
import SummaryCard from "../components/SummaryCard";
import { useAuth } from "../context/AuthContext";

function formatStrictness(value) {
  return String(value || "unknown").replaceAll("_", " ");
}

export default function ClinicalSafetySettingsPage() {
  const {
    doctor,
    safetySettings,
    updateSafetySettings,
    resetSafetySettings,
    defaultSafetySettings,
  } = useAuth();
  const [draftSettings, setDraftSettings] = useState(safetySettings);

  useEffect(() => {
    setDraftSettings(safetySettings);
  }, [safetySettings]);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setDraftSettings((current) => ({
      ...current,
      [name]: value,
    }));
  };

  const handleReset = () => {
    resetSafetySettings();
    setDraftSettings(defaultSafetySettings);
  };

  const handleApply = () => {
    updateSafetySettings(draftSettings);
  };

  const hasPendingChanges = useMemo(
    () => (
      draftSettings.ddiStrictness !== safetySettings.ddiStrictness
      || draftSettings.drugDiseaseStrictness !== safetySettings.drugDiseaseStrictness
    ),
    [draftSettings, safetySettings],
  );

  const ddiSummary = draftSettings.ddiStrictness === "high_signal"
    ? "Only keep DDI relations with PRR >= 50"
    : draftSettings.ddiStrictness === "standard"
      ? "Only keep DDI relations with PRR >= 20"
      : draftSettings.ddiStrictness === "strict"
        ? "Check all DDI relations from the knowledge graph"
        : "Skip all DDI checks";

  const drugDiseaseSummary = draftSettings.drugDiseaseStrictness === "contraindication_only"
    ? "Run contraindication only"
    : draftSettings.drugDiseaseStrictness === "full"
      ? "Run contraindication and off-label checks"
      : "Skip all drug-disease checks";

  return (
    <div className="page-stack">
      <section className="hero-banner medical-hero">
        <div>
          <p className="eyebrow">Clinical Safety Settings</p>
          <h1>Safety policy defaults for {doctor?.name}</h1>
          <p>Configure the prescribing safety policy once here, then automatically apply it to every later risk check and prescription submission.</p>
        </div>
        <Link className="primary-button" to="/patients">
          Go To Patients
        </Link>
      </section>

      <div className="summary-grid">
        <SummaryCard label="DDI Default" value={formatStrictness(safetySettings.ddiStrictness)} hint={ddiSummary} />
        <SummaryCard label="Drug-Disease Default" value={formatStrictness(safetySettings.drugDiseaseStrictness)} hint={drugDiseaseSummary} />
        <SummaryCard label="Status" value={hasPendingChanges ? "Draft Changed" : "Applied"} hint={hasPendingChanges ? "Apply to activate these edits" : "Current defaults are active"} />
      </div>

      <SectionCard
        title="Clinical Safety Settings Dashboard"
        subtitle="Change the draft values below, then click Apply to make them the default for all future prescribing workflows"
      >
        <div className="settings-grid">
          <label>
            DDI strictness
            <select name="ddiStrictness" value={draftSettings.ddiStrictness} onChange={handleChange}>
              <option value="off">Off</option>
              <option value="high_signal">High signal</option>
              <option value="standard">Standard</option>
              <option value="strict">Strict</option>
            </select>
            <small className="muted">Off skips DDI. High signal uses PRR &gt;= 50. Standard uses PRR &gt;= 20. Strict checks all KG DDI relations.</small>
          </label>

          <label>
            Drug-disease strictness
            <select name="drugDiseaseStrictness" value={draftSettings.drugDiseaseStrictness} onChange={handleChange}>
              <option value="off">Off</option>
              <option value="contraindication_only">Only contraindication</option>
              <option value="full">Full check</option>
            </select>
            <small className="muted">Off skips all drug-disease checks. Only contraindication skips off-label. Full runs both contraindication and off-label.</small>
          </label>
        </div>

        <div className="selection-banner applied-rules-banner">
          <span>Draft Configuration</span>
          <strong>DDI: {formatStrictness(draftSettings.ddiStrictness)}</strong>
          <small>Drug-disease: {formatStrictness(draftSettings.drugDiseaseStrictness)}</small>
        </div>

        <div className="settings-note-card">
          <strong>{hasPendingChanges ? "You have unapplied changes." : "This configuration is currently active."}</strong>
          <span>{hasPendingChanges ? "Click Apply to use this configuration for all future prescription checks." : "All future prescription checks will use these defaults until someone changes them."}</span>
        </div>

        <div className="button-row settings-actions-row">
          <button type="button" className="ghost-button" onClick={handleReset}>
            Reset
          </button>
          <button type="button" className="primary-button" onClick={handleApply} disabled={!hasPendingChanges}>
            Apply
          </button>
        </div>
      </SectionCard>
    </div>
  );
}
