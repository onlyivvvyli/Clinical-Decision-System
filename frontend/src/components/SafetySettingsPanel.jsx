import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../context/AuthContext";

function formatStrictness(value) {
  return String(value || "unknown").replaceAll("_", " ");
}

function getDdiStrictnessDescription(value) {
  if (value === "high_signal") {
    return "High signal uses PRR >= 50.";
  }
  if (value === "standard") {
    return "Standard uses PRR >= 20.";
  }
  if (value === "strict") {
    return "Strict checks all KG DDI relations.";
  }
  return "Off skips DDI.";
}

function getDrugDiseaseStrictnessDescription(value) {
  if (value === "contraindication_only") {
    return "Only contraindication skips off-label.";
  }
  if (value === "full") {
    return "Full runs both contraindication and off-label.";
  }
  return "Off skips all drug-disease checks.";
}

function getAiExplanationStyleDescription(value) {
  if (value === "conservative") {
    return "Conservative uses more deterministic, evidence-grounded language.";
  }
  if (value === "exploratory") {
    return "Exploratory allows slightly broader clinical reasoning.";
  }
  return "Balanced is the default recommended setting.";
}

export default function SafetySettingsPanel({ compact = false, onApplyComplete = null }) {
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
    onApplyComplete?.();
  };

  const hasPendingChanges = useMemo(
    () => (
      draftSettings.ddiStrictness !== safetySettings.ddiStrictness
      || draftSettings.drugDiseaseStrictness !== safetySettings.drugDiseaseStrictness
      || draftSettings.aiExplanationStyle !== safetySettings.aiExplanationStyle
    ),
    [draftSettings, safetySettings],
  );

  return (
    <div className={`safety-settings-panel ${compact ? "compact" : ""}`}>
      {compact ? null : (
        <div className="safety-settings-header">
          <div>
            <p className="eyebrow neutral">Clinical Safety Settings</p>
            <h2>Set prescribing defaults</h2>
          </div>
        </div>
      )}

      <div className={`settings-grid safety-settings-grid ${compact ? "compact" : ""}`}>
        <label className="safety-settings-field">
          <span className="safety-settings-field-title">DDI strictness</span>
          <select name="ddiStrictness" value={draftSettings.ddiStrictness} onChange={handleChange}>
            <option value="off">Off</option>
            <option value="high_signal">High signal</option>
            <option value="standard">Standard</option>
            <option value="strict">Strict</option>
          </select>
          <small className="muted">{getDdiStrictnessDescription(draftSettings.ddiStrictness)}</small>
        </label>

        <label className="safety-settings-field">
          <span className="safety-settings-field-title">Drug-disease strictness</span>
          <select name="drugDiseaseStrictness" value={draftSettings.drugDiseaseStrictness} onChange={handleChange}>
            <option value="off">Off</option>
            <option value="contraindication_only">Only contraindication</option>
            <option value="full">Full check</option>
          </select>
          <small className="muted">{getDrugDiseaseStrictnessDescription(draftSettings.drugDiseaseStrictness)}</small>
        </label>

        <label className="safety-settings-field">
          <span className="safety-settings-field-title">AI Explanation Style</span>
          <select name="aiExplanationStyle" value={draftSettings.aiExplanationStyle} onChange={handleChange}>
            <option value="conservative">Conservative</option>
            <option value="balanced">Balanced</option>
            <option value="exploratory">Exploratory</option>
          </select>
          <small className="muted">Controls how conservative or exploratory the AI-generated explanations are.</small>
          <small className="muted">{getAiExplanationStyleDescription(draftSettings.aiExplanationStyle)}</small>
        </label>
      </div>

      <div className={`settings-note-card ${compact ? "compact" : ""}`}>
        <strong>{hasPendingChanges ? "You have unapplied changes." : "This configuration is currently active."}</strong>
        <span>{hasPendingChanges ? "Click Apply to use this configuration for all future prescription checks." : "All future prescription checks will use these defaults until someone changes them."}</span>
      </div>

      <div className={`button-row settings-actions-row ${compact ? "compact" : ""}`}>
        <button type="button" className="ghost-button" onClick={handleReset}>
          Reset
        </button>
        <button type="button" className="primary-button" onClick={handleApply} disabled={!hasPendingChanges}>
          Apply
        </button>
      </div>

      <div className="safety-settings-current-values">
        <span>Current DDI: <strong>{formatStrictness(safetySettings.ddiStrictness)}</strong></span>
        <span>Current drug-disease: <strong>{formatStrictness(safetySettings.drugDiseaseStrictness)}</strong></span>
        <span>Current AI explanation style: <strong>{formatStrictness(safetySettings.aiExplanationStyle)}</strong></span>
      </div>
    </div>
  );
}
