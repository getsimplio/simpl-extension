import { useState } from "react";
import { walletService } from "../../core/wallet/wallet.service";

type RevealPrivateKeyPageProps = {
  onBack: () => void;
};

export function RevealPrivateKeyPage(props: RevealPrivateKeyPageProps) {
  const [password, setPassword] = useState("");
  const [privateKey, setPrivateKey] = useState<string | null>(null);
  const [accountLabel, setAccountLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reveal() {
    setError(null);

    try {
      const result = await walletService.revealPrivateKey({ password });
      setPrivateKey(result.privateKey);
      setAccountLabel(result.account.label);
    } catch {
      setError("Wrong password.");
    }
  }

  return (
    <section className="card">
      <button className="link-button" onClick={props.onBack}>
        ← Back
      </button>

      <h1>Reveal private key</h1>

      <p className="danger-text">
        Never share your private key. It gives full access to this account.
      </p>

      {!privateKey && (
        <>
          <label className="field">
            <span>Password</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>

          {error && <p className="error-text">{error}</p>}

          <button className="danger-button" onClick={reveal}>
            Reveal private key
          </button>
        </>
      )}

      {privateKey && (
        <div className="secret-box">
          <p className="muted">{accountLabel}</p>
          <code>{privateKey}</code>
        </div>
      )}
    </section>
  );
}
