type SimpleWalletHomeCardProps = {
  title?: string;
  balance: string;
  address?: string;
  network?: string;
};

export function SimpleWalletHomeCard({
  title = "Total balance",
  balance,
  address,
  network = "Ethereum",
}: SimpleWalletHomeCardProps) {
  return (
    <section className="simple-wallet-card">
      <div className="simple-wallet-card__top">
        <span className="simple-wallet-card__label">{title}</span>
        <span className="simple-badge simple-badge--success">{network}</span>
      </div>

      <div className="simple-wallet-card__balance">{balance}</div>

      {address ? (
        <div className="simple-wallet-card__address">{address}</div>
      ) : null}
    </section>
  );
}
