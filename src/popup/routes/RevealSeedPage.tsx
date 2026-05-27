import { useState } from "react";
import { walletService } from "../../core/wallet/wallet.service";

type RevealSeedPageProps = {
  onBack: () => void;
};

export function RevealSeedPage(props: RevealSeedPageProps) {
  const [password, setPassword] = useState("");
  const [mnemonic, setMnemonic] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reveal() {
    setError(null);

    try {
      const result = await walletService.revealSeedPhrase({ password });
      setMnemonic(result.mnemonic);
    } catch {
      setError("Wrong password.");
    }
  }

  return (
    <section className="card">
      <button className="link-button" onClick={props.onBack}>
        ← Back
      </button>

      <h1>Reveal seed phrase</h1>

      <p className="danger-text">
        Never share this phrase. Anyone with it can control your wallet.
      </p>

      {!mnemonic && (
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
            Reveal seed phrase
          </button>
        </>
      )}

      {mnemonic && (
        <div className="seed-box">
          {mnemonic.split(" ").map((word, index) => (
            <div className="seed-word" key={`${word}-${index}`}>
              <span>{index + 1}</span>
              <strong>{word}</strong>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
