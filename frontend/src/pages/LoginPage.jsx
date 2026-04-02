import { Navigate, useNavigate } from "react-router-dom";
import { useState } from "react";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";

export default function LoginPage() {
  const navigate = useNavigate();
  const { doctor, login } = useAuth();
  const [form, setForm] = useState({ username: "doctor1", password: "123456" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  if (doctor) {
    return <Navigate to="/dashboard" replace />;
  }

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const result = await api.login(form);
      login(result);
      navigate("/dashboard");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-hero">
        <p className="eyebrow">Clinical Safety Workflow</p>
        <h1>Prescribe with real-time risk alerts before write-back.</h1>
        <p>
          This prototype pulls patient context from FHIR, checks DDI risk in Neo4j Aura, keeps a
          placeholder for drug-disease rules, and writes approved prescriptions back.
        </p>
      </div>
      <form className="card login-card" onSubmit={handleSubmit}>
        <h2>Doctor Login</h2>
        <p className="muted">Use the seeded demo account to enter the prototype.</p>
        <label>
          Username
          <input name="username" value={form.username} onChange={handleChange} required />
        </label>
        <label>
          Password
          <input name="password" type="password" value={form.password} onChange={handleChange} required />
        </label>
        {error ? <div className="error-banner">{error}</div> : null}
        <button className="primary-button" type="submit" disabled={loading}>
          {loading ? "Signing in..." : "Login"}
        </button>
      </form>
    </div>
  );
}
