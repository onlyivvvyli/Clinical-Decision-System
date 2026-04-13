import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";

export default function PrescribeForm({ patientId, doctorId, onSubmit, busy, initialValues = null }) {
  const { safetySettings } = useAuth();
  const [form, setForm] = useState({
    scdName: initialValues?.scdName || "",
    scdRxcui: initialValues?.scdRxcui ? String(initialValues.scdRxcui) : "",
    dosage: initialValues?.dosage || "",
    frequency: initialValues?.frequency || "",
    reason: initialValues?.reason || "",
  });
  const [query, setQuery] = useState(initialValues?.scdName || "");
  const [suggestions, setSuggestions] = useState([]);
  const [searching, setSearching] = useState(false);
  const autocompleteRef = useRef(null);


  useEffect(() => {
    setForm({
      scdName: initialValues?.scdName || "",
      scdRxcui: initialValues?.scdRxcui ? String(initialValues.scdRxcui) : "",
      dosage: initialValues?.dosage || "",
      frequency: initialValues?.frequency || "",
      reason: initialValues?.reason || "",
    });
    setQuery(initialValues?.scdName || "");
  }, [initialValues]);

  useEffect(() => {
    if (!query.trim()) {
      setSuggestions([]);
      return;
    }

    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const data = await api.searchScds(query);
        setSuggestions(data || []);
      } catch {
        setSuggestions([]);
      } finally {
        setSearching(false);
      }
    }, 200);

    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!query.trim() || (!suggestions.length && !searching)) {
      return undefined;
    }

    const handlePointerDown = (event) => {
      if (!autocompleteRef.current?.contains(event.target)) {
        setSuggestions([]);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [query, suggestions.length, searching]);

  const updateField = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  };

  const selectSuggestion = (item) => {
    setForm((current) => ({
      ...current,
      scdName: item.name,
      scdRxcui: String(item.rxcui),
    }));
    setQuery(item.name);
    setSuggestions([]);
  };

  const payload = {
    patientId,
    doctorId,
    scdRxcui: Number(form.scdRxcui),
    scdName: form.scdName || query,
    dosage: form.dosage,
    frequency: form.frequency,
    reason: form.reason,
    ddiStrictness: safetySettings.ddiStrictness,
    drugDiseaseStrictness: safetySettings.drugDiseaseStrictness,
  };

  const canSubmit = Number.isFinite(payload.scdRxcui) && payload.scdRxcui > 0;

  return (
    <form className="prescribe-form compact-prescribe-form" onSubmit={(event) => event.preventDefault()}>
      <div className="form-grid compact-form-grid">
        <label ref={autocompleteRef} className="full-width autocomplete-field">
          Search SCD Name
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setForm((current) => ({ ...current, scdName: event.target.value }));
            }}
            placeholder="Search medication"
          />
          {query && (suggestions.length > 0 || searching) ? (
            <div className="autocomplete-list">
              {searching ? <div className="autocomplete-item muted-item">Searching...</div> : null}
              {suggestions.map((item) => (
                <button
                  key={item.rxcui}
                  type="button"
                  className="autocomplete-item"
                  onClick={() => selectSuggestion(item)}
                >
                  <strong>{item.name}</strong>
                  <span>RxCUI {item.rxcui}</span>
                </button>
              ))}
            </div>
          ) : null}
        </label>

        <label>
          RxCUI
          <input
            name="scdRxcui"
            value={form.scdRxcui}
            onChange={updateField}
            placeholder="RxCUI"
            inputMode="numeric"
          />
        </label>
        <label>
          Dosage
          <input name="dosage" value={form.dosage} onChange={updateField} />
        </label>
        <label>
          Frequency
          <input name="frequency" value={form.frequency} onChange={updateField} />
        </label>
        <label className="full-width">
          Reason
          <input name="reason" value={form.reason} onChange={updateField} />
        </label>
      </div>

      <div className="button-row compact-button-row">
        <button type="button" className="primary-button" disabled={busy || !canSubmit} onClick={() => onSubmit(payload)}>
          Submit Prescription
        </button>
      </div>
    </form>
  );
}
