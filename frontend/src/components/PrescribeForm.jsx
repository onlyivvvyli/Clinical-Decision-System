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
  const suppressNextSuggestionFetchRef = useRef(false);

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
    if (suppressNextSuggestionFetchRef.current) {
      suppressNextSuggestionFetchRef.current = false;
      return;
    }

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

  const handleMedicationChange = (event) => {
    const nextValue = event.target.value;
    setQuery(nextValue);
    setForm((current) => ({
      ...current,
      scdName: nextValue,
      scdRxcui: current.scdName === nextValue ? current.scdRxcui : "",
    }));
  };

  const selectSuggestion = (item) => {
    suppressNextSuggestionFetchRef.current = true;
    setForm((current) => ({
      ...current,
      scdName: item.name,
      scdRxcui: String(item.rxcui),
    }));
    setQuery(item.name);
    setSuggestions([]);
    setSearching(false);
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
    <form className="prescribe-form prescribe-order-form" onSubmit={(event) => event.preventDefault()}>
      <div className="prescribe-order-fields">
        <label ref={autocompleteRef} className="autocomplete-field prescribe-order-field">
          <span>Search medication</span>
          <input
            value={query}
            onChange={handleMedicationChange}
            placeholder="Search SCD name"
          />
          {query && (suggestions.length > 0 || searching) ? (
            <div className="autocomplete-list prescribe-order-autocomplete-list">
              {searching ? <div className="autocomplete-item muted-item">Searching...</div> : null}
              {suggestions.map((item) => (
                <button
                  key={item.rxcui}
                  type="button"
                  className="autocomplete-item prescribe-order-autocomplete-item"
                  onClick={() => selectSuggestion(item)}
                >
                  <strong>{item.name}</strong>
                  <span>RxCUI {item.rxcui}</span>
                </button>
              ))}
            </div>
          ) : null}
        </label>

        <label className="prescribe-order-field">
          <span>RxCUI</span>
          <input
            value={form.scdRxcui}
            placeholder="RxCUI"
            readOnly
            aria-readonly="true"
            className="prescribe-order-readonly"
          />
        </label>

        <label className="prescribe-order-field">
          <span>Dosage</span>
          <input name="dosage" value={form.dosage} onChange={updateField} placeholder="Dosage" />
        </label>

        <label className="prescribe-order-field">
          <span>Frequency</span>
          <input name="frequency" value={form.frequency} onChange={updateField} placeholder="Frequency" />
        </label>

        <label className="prescribe-order-field">
          <span>Reason</span>
          <textarea
            name="reason"
            value={form.reason}
            onChange={updateField}
            placeholder="Optional prescribing indication"
            rows={4}
          />
        </label>
      </div>

      <div className="button-row prescribe-order-actions">
        <button type="button" className="primary-button prescribe-order-submit" disabled={busy || !canSubmit} onClick={() => onSubmit(payload)}>
          Submit Prescription
        </button>
      </div>
    </form>
  );
}
