export default function SummaryCard({ label, value, hint }) {
  return (
    <div className="card summary-card">
      <p className="eyebrow">{label}</p>
      <h3>{value}</h3>
      <span>{hint}</span>
    </div>
  );
}
