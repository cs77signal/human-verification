
export default function Home() {
  return (
    <main className="container">
      <header className="header">
        <a href="/" className="brand">
          ⊕ cs77signal
        </a>
        <span className="label">HUMAN VERIFICATION</span>
      </header>

      <section className="hero">
        <p className="eyebrow">CS77 · WORLD ID</p>

        <h1>
          Prove you are human.
          <br />
          Keep your identity private.
        </h1>

        <p className="description">
          Verify that you are a unique human without
          revealing your identity.
        </p>

        <div className="verification">
          <p className="verification-title">
            HUMAN VERIFICATION
          </p>

          <p className="verification-description">
            World ID verification will be available here.
          </p>

          <button type="button" disabled>
            Verification coming soon
          </button>
        </div>
      </section>

      <footer className="footer">
        <span>⊕ CS77</span>
        <span>AI THINKS • CS77 EXECUTES</span>
        <span>@cs77signal</span>
      </footer>
    </main>
  );
}
