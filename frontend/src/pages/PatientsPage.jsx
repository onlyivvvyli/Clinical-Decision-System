import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import SectionCard from "../components/SectionCard";
import { api } from "../lib/api";

const PAGE_SIZE = 20;

export default function PatientsPage() {
  const [patients, setPatients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    api
      .getPatients()
      .then((data) => {
        setPatients(data);
        setPage(1);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const totalPages = Math.max(1, Math.ceil(patients.length / PAGE_SIZE));

  useEffect(() => {
    setPage((current) => Math.min(current, totalPages));
  }, [totalPages]);

  const visiblePatients = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return patients.slice(start, start + PAGE_SIZE);
  }, [patients, page]);

  return (
    <div className="page-stack">
      <section className="hero-banner compact">
        <div>
          <p className="eyebrow">Patient Registry</p>
          <h1>FHIR Patient List</h1>
          <p>Open a patient summary to review conditions, current medications, and prescribing safety checks.</p>
        </div>
      </section>

      <SectionCard title="Patients" subtitle="Basic demographics loaded from FHIR Patient resources">
        {loading ? <div className="empty-state">Loading patients...</div> : null}
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
                    <tr key={patient.id}>
                      <td>{patient.id}</td>
                      <td>{patient.name}</td>
                      <td>{patient.gender}</td>
                      <td>{patient.birth_date || "N/A"}</td>
                      <td>{patient.age}</td>
                      <td>
                        <Link className="inline-link" to={`/patients/${patient.id}`}>
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
                    onClick={() => setPage((current) => Math.max(1, current - 1))}
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    className="ghost-button"
                    disabled={page === totalPages}
                    onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
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
