import { useEffect, useMemo, useState } from "react";
import SectionCard from "../components/SectionCard";
import { useAuth } from "../context/AuthContext";

function formatStrictness(value) {
  return String(value || "unknown").replaceAll("_", " ");
}

export default function ClinicalSafetySettingsPage() {
  const {
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

  return (
    <div className="page-stack">
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
