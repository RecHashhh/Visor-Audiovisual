// src/pages/ComingSoonPage.jsx
export default function ComingSoonPage({ section }) {
  if (!section) return null

  return (
    <div className="coming-soon">
      <div className="coming-soon-badge">Próxima fase del rework</div>
      <h1 className="coming-soon-title">{section.label}</h1>
      <p className="coming-soon-text">{section.description}</p>
      <p className="coming-soon-note">
        Esta sección se construye en la siguiente fase, sobre el mismo hub que ya estás usando.
      </p>
    </div>
  )
}
