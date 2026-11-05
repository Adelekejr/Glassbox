import { Brand } from "./Brand";

export function SiteFooter() {
  return (
    <footer className="footer">
      <div className="wrap">
        <div className="footer-grid">
          <div>
            <Brand />
            <p style={{ marginTop: 20 }}>
              Free, open-source (MIT) public auditor for AI-agent contracts on NEAR. Entered in the NEAR Hackathon,
              Security track.
            </p>
            <p style={{ marginTop: 12 }}>
              It does not judge whether a payment is correct. That is{" "}
              <a href="https://github.com/Adelekejr/Gideon-near">Gideon</a>, a separate project by the same builder.
            </p>
          </div>
          <div className="footer-cols">
            <div>
              <span className="label">Product</span>
              <ul>
                <li><a href="/#audit">Audit</a></li>
                <li><a href="/#ladder">The ladder</a></li>
                <li><a href="/accounts">Account list</a></li>
              </ul>
            </div>
            <div>
              <span className="label">Use it</span>
              <ul>
                <li><a href="/#surfaces">CLI</a></li>
                <li><a href="/#surfaces">MCP check_agent</a></li>
                <li><a href="/#tools">Signed reports</a></li>
              </ul>
            </div>
            <div>
              <span className="label">Source</span>
              <ul>
                <li><a href="https://github.com/Adelekejr/Glassbox">Repository</a></li>
                <li><a href="https://github.com/Adelekejr/Glassbox/blob/main/NOTICE">NOTICE</a></li>
                <li><a href="https://github.com/Adelekejr/Glassbox/blob/main/LICENSE">MIT licence</a></li>
              </ul>
            </div>
          </div>
        </div>
        <div className="footer-base">
          <span>Copyright (c) 2026 Adelekejr · MIT</span>
          <span>The local web form is not deployed.</span>
        </div>
      </div>
    </footer>
  );
}
