export default function SectionCard({
  title,
  subtitle,
  children,
  actions,
  collapsible = false,
  defaultExpanded = true,
  expanded,
  onToggle,
  className = "",
  bodyClassName = "",
}) {
  const isExpanded = expanded ?? defaultExpanded;

  const handleToggle = () => {
    if (collapsible && onToggle) {
      onToggle(!isExpanded);
    }
  };

  return (
    <section className={`card section-card ${collapsible ? "collapsible-card" : ""} ${className}`.trim()}>
      <div className="section-header">
        <div>
          <div className="section-title-row">
            <h2>{title}</h2>
            {collapsible ? (
              <button
                type="button"
                className="collapse-toggle"
                aria-expanded={isExpanded}
                aria-label={isExpanded ? `Collapse ${title}` : `Expand ${title}`}
                onClick={handleToggle}
              >
                <span>{isExpanded ? "Collapse" : "Expand"}</span>
                <strong>{isExpanded ? "-" : "+"}</strong>
              </button>
            ) : null}
          </div>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        {actions}
      </div>
      {isExpanded ? <div className={bodyClassName}>{children}</div> : null}
    </section>
  );
}
