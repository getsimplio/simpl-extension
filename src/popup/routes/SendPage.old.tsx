import { useEffect, useState } from "react";
import { isAddress } from "ethers";
import type { WalletAccount } from "../../core/accounts/account.types";
import type { WalletState } from "../../core/storage/storage.types";
import type { WalletAssetBalance } from "../../core/tokens/token-balance.service";
import { walletService } from "../../core/wallet/wallet.service";
import { SimpleButton, SimpleNotice, SimplePage } from "../../ui";

type SendPageProps = {
  asset: WalletAssetBalance;
  selectedAccount: WalletAccount;
  walletState: WalletState;
  onBack: () => void;
  onSent: () => void;
};

type SendStep = "form" | "review" | "success";

type SentTransaction = {
  hash: string;
  explorerUrl: string | null;
};

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function getNetworkLabel(chainId: number): string {
  if (chainId === 1) return "Ethereum";
  if (chainId === 56) return "BNB Chain";
  if (chainId === 8453) return "Base";
  if (chainId === 11155111) return "Sepolia";

  return "Unknown";
}

function normalizeAmount(value: string): string {
  return value.trim().replace(",", ".");
}

function isPositiveAmount(value: string): boolean {
  const normalizedValue = normalizeAmount(value);

  if (!/^\d+(\.\d+)?$/.test(normalizedValue)) {
    return false;
  }

  return Number(normalizedValue) > 0;
}

function formatAssetBalance(asset: WalletAssetBalance): string {
  const value = Number(asset.formatted);

  if (!Number.isFinite(value)) {
    return asset.formatted;
  }

  if (value === 0) return "0";

  if (value < 0.000001) {
    return "<0.000001";
  }

  if (value < 1) {
    return value.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
  }

  return value.toLocaleString("en-US", {
    maximumFractionDigits: asset.decimals === 6 ? 2 : 6,
  });
}

function BackIcon() {
  return <span>‹</span>;
}

export function SendPage({
  asset,
  selectedAccount,
  walletState,
  onBack,
  onSent,
}: SendPageProps) {
  const [selectedAsset, setSelectedAsset] = useState<WalletAssetBalance>(asset);
  const [availableAssets, setAvailableAssets] = useState<WalletAssetBalance[]>([
    asset,
  ]);

  const [step, setStep] = useState<SendStep>("form");
  const [toAddress, setToAddress] = useState("");
  const [amount, setAmount] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingAssets, setLoadingAssets] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTransaction, setSentTransaction] =
    useState<SentTransaction | null>(null);

  const normalizedAmount = normalizeAmount(amount);
  const recipientIsValid = isAddress(toAddress.trim());
  const amountIsValid = isPositiveAmount(amount);
  const canContinue = recipientIsValid && amountIsValid && !sending;
  const isWatchOnly = selectedAccount.type === "watch";

  useEffect(() => {
    setSelectedAsset(asset);
    setAvailableAssets([asset]);
    setAmount("");
    setError(null);
    setStep("form");
  }, [asset.id]);

  useEffect(() => {
    let active = true;

    async function loadAssets() {
      setLoadingAssets(true);

      try {
        const portfolio = await walletService.getSelectedPortfolio();

        if (!active) return;

        const visibleAssets = portfolio.assets.filter((item) => item.visible);

        setAvailableAssets(visibleAssets.length > 0 ? visibleAssets : [asset]);

        const freshSelectedAsset = visibleAssets.find((item) => {
          return item.id === asset.id;
        });

        if (freshSelectedAsset) {
          setSelectedAsset(freshSelectedAsset);
        }
      } catch {
        if (!active) return;

        setAvailableAssets([asset]);
      } finally {
        if (active) {
          setLoadingAssets(false);
        }
      }
    }

    void loadAssets();

    return () => {
      active = false;
    };
  }, [asset.id]);

  function handleBack() {
    if (step === "review") {
      setStep("form");
      setError(null);
      return;
    }

    if (step === "success") {
      onSent();
      return;
    }

    onBack();
  }

  function selectAsset(nextAsset: WalletAssetBalance) {
    setSelectedAsset(nextAsset);
    setAmount("");
    setError(null);
    setStep("form");
  }

  function handleMaxAmount() {
    if (selectedAsset.type === "native") {
      setError("For native assets, keep some balance for network gas.");
      return;
    }

    setError(null);
    setAmount(selectedAsset.formatted);
  }

  async function submitForm() {
    setError(null);

    if (isWatchOnly) {
      setError("Watch-only account cannot send transactions.");
      return;
    }

    if (!recipientIsValid) {
      setError("Enter a valid recipient address.");
      return;
    }

    if (!amountIsValid) {
      setError("Enter a valid amount.");
      return;
    }

    setStep("review");
  }

  async function sendTransaction() {
    if (!canContinue || isWatchOnly) return;

    setSending(true);
    setError(null);

    try {
      const result = await walletService.sendSelectedAsset({
        asset: selectedAsset,
        toAddress: toAddress.trim(),
        amount: normalizedAmount,
      });

      setSentTransaction({
        hash: result.hash,
        explorerUrl: result.explorerUrl,
      });

      setStep("success");
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setSending(false);
    }
  }

  return (
    <SimplePage className="simple-send-page">
      <div className="simple-topbar">
        <div className="simple-topbar__left">
          <button
            type="button"
            className="simple-back-button"
            onClick={handleBack}
            aria-label="Go back"
          >
            <BackIcon />
          </button>

          <div className="simple-topbar__label">Send</div>
        </div>
      </div>

      <div className="simple-screen-scroll">
        <section className="simple-send-hero">
          <span className="simple-send-asset-icon">
            {selectedAsset.symbol.slice(0, 1)}
          </span>

          <div>
            <h1 className="simple-title">
              Send
              <br />
              {selectedAsset.symbol}
            </h1>

            <p className="simple-subtitle">
              Balance: {formatAssetBalance(selectedAsset)} {selectedAsset.symbol}
            </p>
          </div>
        </section>

        <section className="simple-send-token-selector">
          <div className="simple-send-token-selector__header">
            <span>Asset to send</span>
            <small>{loadingAssets ? "Loading..." : "Tap to switch"}</small>
          </div>

          <div className="simple-send-token-selector__list">
            {availableAssets.map((item) => {
              const selected = item.id === selectedAsset.id;

              return (
                <button
                  key={item.id}
                  type="button"
                  className={
                    selected
                      ? "simple-send-token-option simple-send-token-option--active"
                      : "simple-send-token-option"
                  }
                  onClick={() => selectAsset(item)}
                >
                  <span className="simple-send-token-option__icon">
                    {item.symbol.slice(0, 1)}
                  </span>

                  <span className="simple-send-token-option__body">
                    <strong>{item.symbol}</strong>
                    <small>{item.name}</small>
                  </span>

                  <span className="simple-send-token-option__balance">
                    {formatAssetBalance(item)}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        {isWatchOnly ? (
          <SimpleNotice title="Watch-only account" variant="warning">
            This account can receive assets, but cannot sign outgoing
            transactions.
          </SimpleNotice>
        ) : null}

        {error ? (
          <SimpleNotice title="Send error" variant="danger">
            {error}
          </SimpleNotice>
        ) : null}

        {step === "form" ? (
          <form
            className="simple-send-form"
            onSubmit={(event) => {
              event.preventDefault();
              void submitForm();
            }}
          >
            <label className="simple-field">
              <span className="simple-label">Recipient address</span>

              <input
                className="simple-input"
                value={toAddress}
                placeholder="0x..."
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => {
                  setToAddress(event.target.value);
                  setError(null);
                }}
              />
            </label>

            <label className="simple-field">
              <div className="simple-field-row">
                <span className="simple-label">Amount</span>

                <button
                  type="button"
                  className="simple-send-max-button"
                  onClick={handleMaxAmount}
                >
                  Max
                </button>
              </div>

              <div className="simple-send-amount-input">
                <input
                  className="simple-input"
                  value={amount}
                  placeholder="0.00"
                  inputMode="decimal"
                  autoComplete="off"
                  onChange={(event) => {
                    setAmount(event.target.value);
                    setError(null);
                  }}
                />

                <span>{selectedAsset.symbol}</span>
              </div>
            </label>

            <section className="simple-send-meta-card">
              <div>
                <span>From</span>
                <strong>{shortAddress(selectedAccount.address)}</strong>
              </div>

              <div>
                <span>Network</span>
                <strong>{getNetworkLabel(walletState.selectedChainId)}</strong>
              </div>

              <div>
                <span>Asset</span>
                <strong>
                  {selectedAsset.type === "native" ? "Native" : "ERC-20"}
                </strong>
              </div>
            </section>

            <SimpleButton type="submit" disabled={!canContinue || isWatchOnly}>
              Continue
            </SimpleButton>
          </form>
        ) : null}

        {step === "review" ? (
          <section className="simple-send-review">
            <section className="simple-send-review-card">
              <h2>Review transfer</h2>

              <div className="simple-send-review-row">
                <span>Amount</span>
                <strong>
                  {normalizedAmount} {selectedAsset.symbol}
                </strong>
              </div>

              <div className="simple-send-review-row">
                <span>To</span>
                <strong>{shortAddress(toAddress.trim())}</strong>
              </div>

              <div className="simple-send-review-row">
                <span>From</span>
                <strong>{shortAddress(selectedAccount.address)}</strong>
              </div>

              <div className="simple-send-review-row">
                <span>Network</span>
                <strong>{getNetworkLabel(walletState.selectedChainId)}</strong>
              </div>

              <div className="simple-send-review-row">
                <span>Asset</span>
                <strong>{selectedAsset.symbol}</strong>
              </div>
            </section>

            <SimpleNotice title="Check carefully" variant="warning">
              Transactions cannot be cancelled after they are sent.
            </SimpleNotice>

            <SimpleButton
              type="button"
              onClick={() => void sendTransaction()}
              disabled={sending}
            >
              {sending ? "Sending..." : "Send transaction"}
            </SimpleButton>

            <SimpleButton
              type="button"
              variant="secondary"
              onClick={() => setStep("form")}
              disabled={sending}
            >
              Edit details
            </SimpleButton>
          </section>
        ) : null}

        {step === "success" && sentTransaction ? (
          <section className="simple-send-success">
            <div className="simple-send-success__icon">✓</div>

            <h1 className="simple-title">
              Transaction
              <br />
              sent
            </h1>

            <p className="simple-subtitle">
              Your {selectedAsset.symbol} transfer was submitted to the network.
            </p>

            <section className="simple-send-review-card">
              <div className="simple-send-review-row">
                <span>Hash</span>
                <strong>{shortAddress(sentTransaction.hash)}</strong>
              </div>

              <div className="simple-send-review-row">
                <span>Amount</span>
                <strong>
                  {normalizedAmount} {selectedAsset.symbol}
                </strong>
              </div>
            </section>

            {sentTransaction.explorerUrl ? (
              <a
                className="simple-send-explorer-link"
                href={sentTransaction.explorerUrl}
                target="_blank"
                rel="noreferrer"
              >
                Open in explorer
              </a>
            ) : null}

            <SimpleButton type="button" onClick={onSent}>
              Done
            </SimpleButton>
          </section>
        ) : null}
      </div>
    </SimplePage>
  );
}