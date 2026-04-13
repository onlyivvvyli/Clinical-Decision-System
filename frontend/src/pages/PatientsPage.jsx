import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import SectionCard from "../components/SectionCard";
import { api } from "../lib/api";

const PAGE_SIZE = 20;
const PATIENT_LIST_STATE_KEY = "patient-list-state";
const PATIENT_LIST_CACHE_KEY = "patient-list-cache-v1";

function readPatientListState() {
  try {
    const raw = sessionStorage.getItem(PATIENT_LIST_STATE_KEY);
    if (!raw) {
      return { page: 1, focusPatientId: "" };
    }

    const parsed = JSON.parse(raw);
    return {
      page: Number.isFinite(Number(parsed?.page)) && Number(parsed.page) > 0 ? Number(parsed.page) : 1,
      focusPatientId: typeof parsed?.focusPatientId === "string" ? parsed.focusPatientId : "",
    };
  } catch {
    return { page: 1, focusPatientId: "" };
  }
}

function writePatientListState(nextState) {
  sessionStorage.setItem(PATIENT_LIST_STATE_KEY, JSON.stringify(nextState));
}

function readPatientListCache() {
  try {
    const raw = sessionStorage.getItem(PATIENT_LIST_CACHE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writePatientListCache(patients) {
  sessionStorage.setItem(PATIENT_LIST_CACHE_KEY, JSON.stringify(patients));
}

const initialListState = readPatientListState();
const initialPatients = readPatientListCache();

export default function PatientsPage() {
  const [patients, setPatients] = useState(initialPatients);
  const [loading, setLoading] = useState(initialPatients.length === 0);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [page, setPage] = useState(initialListState.page);
  const [focusPatientId, setFocusPatientId] = useState(initialListState.focusPatientId);
  const [highlightPatientId, setHighlightPatientId] = useState("");
  const linkRefs = useRef(new Map());
  const scrollModeRef = useRef("");

  useEffect(() => {
    let isMounted = true;

    const applyPatientList = (data) => {
      if (!isMounted) {
        return;
      }

      setPatients(data);
      writePatientListCache(data);

      if (focusPatientId) {
        const focusIndex = data.findIndex((patient) => patient.id === focusPatientId);
        if (focusIndex >= 0) {
          const targetPage = Math.floor(focusIndex / PAGE_SIZE) + 1;
          setPage(targetPage);
          setHighlightPatientId(focusPatientId);
          writePatientListState({ page: targetPage, focusPatientId });
          scrollModeRef.current = "focus-patient";
          return;
        }
      }

      const maxPage = Math.max(1, Math.ceil(data.length / PAGE_SIZE));
      const nextPage = Math.min(page, maxPage);
      setPage(nextPage);
      writePatientListState({ page: nextPage, focusPatientId: "" });
    };

    setRefreshing(initialPatients.length > 0);
    api
      .getPatients()
      .then((data) => {
        applyPatientList(data);
        setError("");
      })
      .catch((err) => {
        if (!isMounted) {
          return;
        }
        setError(err.message);
      })
      .finally(() => {
        if (!isMounted) {
          return;
        }
        setLoading(false);
        setRefreshing(false);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const totalPages = Math.max(1, Math.ceil(patients.length / PAGE_SIZE));

  useEffect(() => {
    setPage((current) => {
      const nextPage = Math.min(current, totalPages);
      if (nextPage !== current) {
        writePatientListState({ page: nextPage, focusPatientId });
      }
      return nextPage;
    });
  }, [totalPages, focusPatientId]);

  const visiblePatients = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return patients.slice(start, start + PAGE_SIZE);
  }, [patients, page]);

  useEffect(() => {
    if (loading || !visiblePatients.length || !scrollModeRef.current) {
      return;
    }

    const targetId = scrollModeRef.current === "focus-patient"
      ? focusPatientId
      : visiblePatients[0]?.id;
    const targetLink = targetId ? linkRefs.current.get(targetId) : null;
    if (!targetLink) {
      return;
    }

    const frame = requestAnimationFrame(() => {
      targetLink.scrollIntoView({ block: "start", behavior: "auto" });
      if (scrollModeRef.current === "focus-patient") {
        targetLink.focus({ preventScroll: true });
        setFocusPatientId("");
        writePatientListState({ page, focusPatientId: "" });
      }
      scrollModeRef.current = "";
    });

    return () => cancelAnimationFrame(frame);
  }, [focusPatientId, loading, page, visiblePatients]);

  useEffect(() => {
    if (!highlightPatientId) {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      setHighlightPatientId("");
    }, 2200);

    return () => window.clearTimeout(timer);
  }, [highlightPatientId]);

  const prefetchPatientSummary = (patientId) => {
    api.prefetchPatientSummary(patientId);
  };

  const handlePageChange = (nextPage) => {
    setFocusPatientId("");
    setHighlightPatientId("");
    setPage(nextPage);
    writePatientListState({ page: nextPage, focusPatientId: "" });
    scrollModeRef.current = "page-start";
  };

  const handlePatientOpen = (patientId) => {
    setFocusPatientId(patientId);
    writePatientListState({ page, focusPatientId: patientId });
  };

  return (
    <div className="page-stack">
      <section className="hero-banner compact patient-list-hero">
        <div>
          <p className="eyebrow">Patient Registry</p>
          <h1>FHIR Patient List</h1>
          <p>Open a patient summary to review conditions, current medications, and prescribing safety checks.</p>
        </div>
      </section>

      <SectionCard title="Patients" subtitle="Basic demographics loaded from FHIR Patient resources">
        {loading ? <div className="empty-state">Loading patients...</div> : null}
        {!loading && refreshing ? <div className="empty-state">Refreshing patient list...</div> : null}
        {error ? <div className="error-banner">{error}</div> : null}
        {!loading && !error ? (
          <div className="section-content-stack">
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Patient ID</th>
                    <th>Name</th>
                    <th>Gender</th>
                    <th>Birth Date</th>
                    <th>Age</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {visiblePatients.map((patient) => (
                    <tr key={patient.id} className={highlightPatientId === patient.id ? "patient-row-highlight" : ""}>
                      <td>{patient.id}</td>
                      <td>{patient.name}</td>
                      <td>{patient.gender}</td>
                      <td>{patient.birth_date || "N/A"}</td>
                      <td>{patient.age}</td>
                      <td>
                        <Link
                          className="inline-link"
                          to={`/patients/${patient.id}`}
                          state={{ patient }}
                          ref={(node) => {
                            if (node) {
                              linkRefs.current.set(patient.id, node);
                            } else {
                              linkRefs.current.delete(patient.id);
                            }
                          }}
                          onClick={() => handlePatientOpen(patient.id)}
                          onMouseEnter={() => prefetchPatientSummary(patient.id)}
                          onFocus={() => prefetchPatientSummary(patient.id)}
                        >
                          View Details
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {patients.length > PAGE_SIZE ? (
              <div className="pagination-bar">
                <span className="pagination-copy">
                  Page {page} / {totalPages} | {patients.length} patients
                </span>
                <div className="pagination-actions">
                  <button
                    type="button"
                    className="ghost-button"
                    disabled={page === 1}
                    onClick={() => handlePageChange(Math.max(1, page - 1))}
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    className="ghost-button"
                    disabled={page === totalPages}
                    onClick={() => handlePageChange(Math.min(totalPages, page + 1))}
                  >
                    Next
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </SectionCard>
    </div>
  );
}
