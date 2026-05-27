// SIMPLE — Mobile app preview (iOS)
// Three screens shown side-by-side inside iOS frames.

const { useState: useMState, useEffect: useMEffect } = React;

function MIcon({ name, size = 18 }) {
  useMEffect(() => { if (window.lucide) window.lucide.createIcons(); });
  return <i data-lucide={name} style={{ width: size, height: size, display: 'inline-flex' }} />;
}

const MTOKENS = [
  { sym: 'Ξ', cls: 'eth', name: 'Ethereum', qty: '0.4218 ETH', fiat: '$1,284.22', delta: '+1.2%', up: true },
  { sym: '$', cls: 'usdc', name: 'USD Coin', qty: '5,210.00 USDC', fiat: '$5,210.00', delta: '+0.0%', up: true },
  { sym: '₿', cls: 'wbtc', name: 'Bitcoin', qty: '0.082 wBTC', fiat: '$6,353.00', delta: '−0.8%', up: false },
  { sym: 'U', cls: 'uni', name: 'Uniswap', qty: '32.5 UNI', fiat: '$281.20', delta: '+3.4%', up: true },
];

const MACT = [
  { dir: 'receive', label: 'Receive · ETH', target: '0x9c4f…3a1b', amt: '+0.05 ETH', fiat: '+$152.10', time: '12 min', status: 'confirmed' },
  { dir: 'send', label: 'Send · USDC', target: '0x842a…7f0c', amt: '−120 USDC', fiat: '−$120.00', time: '1 hr', status: 'pending' },
  { dir: 'swap', label: 'Swap · ETH → USDC', target: 'via 0x', amt: '0.5 ETH', fiat: '$1,521.09', time: 'Yesterday', status: 'confirmed' },
];

// ─────── Home ───────
function MobileHome() {
  return (
    <div className="m-screen">
      <div className="m-topbar">
        <button className="m-acct">
          <span className="m-av" />
          Main
          <MIcon name="chevron-down" size={12} />
        </button>
        <button className="m-net"><span className="m-dot" />Ethereum</button>
        <button className="m-icbtn"><MIcon name="qr-code" size={18} /></button>
      </div>
      <div className="m-balance">
        <div className="m-lbl">Total balance</div>
        <div className="m-val">$12,847.<span className="cents">22</span></div>
        <div className="m-delta">
          <span className="up">+$144.20</span> · 1.2% today
          <span className="m-secure">● Secure</span>
        </div>
      </div>
      <div className="m-actions">
        <div className="m-action"><div className="m-action-ic"><MIcon name="arrow-up-right" size={18} /></div>Send</div>
        <div className="m-action"><div className="m-action-ic"><MIcon name="arrow-down-left" size={18} /></div>Receive</div>
        <div className="m-action"><div className="m-action-ic"><MIcon name="arrow-left-right" size={18} /></div>Swap</div>
        <div className="m-action"><div className="m-action-ic"><MIcon name="plus" size={18} /></div>Buy</div>
      </div>
      <div className="m-tabs">
        <button className="active">Tokens</button>
        <button>NFTs</button>
        <button>Activity</button>
      </div>
      <div className="m-list">
        {MTOKENS.map((t, i) => (
          <div key={i} className="m-row">
            <div className={`m-tok ${t.cls}`}>{t.sym}</div>
            <div className="m-body">
              <div className="nm">{t.name}</div>
              <div className="sub">{t.qty} · <span className={t.up ? 'up' : 'down'}>{t.delta}</span></div>
            </div>
            <div className="m-num">{t.fiat}</div>
          </div>
        ))}
      </div>
      <div className="m-bottomnav">
        <div className="m-navi active"><MIcon name="wallet" size={20} /><span>Wallet</span></div>
        <div className="m-navi"><MIcon name="list" size={20} /><span>Activity</span></div>
        <div className="m-navi"><MIcon name="arrow-left-right" size={20} /><span>Swap</span></div>
        <div className="m-navi"><MIcon name="shield-check" size={20} /><span>Security</span></div>
      </div>
    </div>
  );
}

// ─────── Send ───────
function MobileSend() {
  return (
    <div className="m-screen">
      <div className="m-pgheader">
        <button className="m-icbtn"><MIcon name="arrow-left" size={20} /></button>
        <div className="m-title">Send</div>
        <button className="m-icbtn"><MIcon name="scan-line" size={20} /></button>
      </div>
      <div className="m-form">
        <div className="m-field">
          <span className="m-flbl">To</span>
          <div className="m-input mono">0x9c4f3a1bd827e0…</div>
        </div>
        <div className="m-field">
          <span className="m-flbl">Amount</span>
          <div className="m-amount-box">
            <div className="m-amount">0.5</div>
            <div className="m-amount-tok">ETH ▾</div>
          </div>
          <div className="m-amount-meta">
            <span>≈ $1,521.09</span>
            <span>Available 0.4218 · <b>Max</b></span>
          </div>
        </div>
        <div className="m-feebox">
          <span>Network fee · standard</span>
          <span className="mono">$0.42 · 12 gwei</span>
        </div>
      </div>
      <div className="m-form-foot">
        <button className="m-btn primary">Review</button>
      </div>
    </div>
  );
}

// ─────── Activity ───────
function MobileActivity() {
  return (
    <div className="m-screen">
      <div className="m-topbar">
        <button className="m-acct"><span className="m-av" />Main<MIcon name="chevron-down" size={12} /></button>
        <button className="m-net"><span className="m-dot" />Ethereum</button>
        <button className="m-icbtn"><MIcon name="search" size={18} /></button>
      </div>
      <div className="m-page-title">
        <div className="t-h2">Activity</div>
        <div className="m-sub">24 transactions · this account</div>
      </div>
      <div className="m-filterbar">
        <button className="active">All</button>
        <button>Sent</button>
        <button>Received</button>
        <button>Swaps</button>
      </div>
      <div className="m-list" style={{ flex: 1 }}>
        <div className="m-section-lbl">Today</div>
        {MACT.slice(0, 2).map((a, i) => (
          <div key={i} className="m-row">
            <div className="m-tok act">
              <MIcon name={a.dir === 'send' ? 'arrow-up-right' : a.dir === 'receive' ? 'arrow-down-left' : 'arrow-left-right'} size={14} />
            </div>
            <div className="m-body">
              <div className="nm">{a.label.split('·')[0].trim()}</div>
              <div className="sub mono">
                {a.status === 'pending' && <span style={{ color: 'var(--warn)' }}>Pending · </span>}
                {a.target} · <span style={{ color: 'var(--ink-3)' }}>{a.time}</span>
              </div>
            </div>
            <div className="m-num" style={{ display: 'flex', flexDirection: 'column', gap: 2, textAlign: 'right' }}>
              <span style={{ color: a.dir === 'send' ? 'var(--ink-1)' : 'var(--secure)', fontFamily: 'var(--font-mono)' }}>{a.amt}</span>
              <span style={{ color: 'var(--ink-3)', fontSize: 11, fontFamily: 'var(--font-mono)' }}>{a.fiat}</span>
            </div>
          </div>
        ))}
        <div className="m-section-lbl">Earlier</div>
        {MACT.slice(2).map((a, i) => (
          <div key={i + 10} className="m-row">
            <div className="m-tok act">
              <MIcon name={a.dir === 'send' ? 'arrow-up-right' : a.dir === 'receive' ? 'arrow-down-left' : 'arrow-left-right'} size={14} />
            </div>
            <div className="m-body">
              <div className="nm">{a.label.split('·')[0].trim()}</div>
              <div className="sub mono">{a.target} · <span style={{ color: 'var(--ink-3)' }}>{a.time}</span></div>
            </div>
            <div className="m-num" style={{ display: 'flex', flexDirection: 'column', gap: 2, textAlign: 'right' }}>
              <span style={{ fontFamily: 'var(--font-mono)' }}>{a.amt}</span>
              <span style={{ color: 'var(--ink-3)', fontSize: 11, fontFamily: 'var(--font-mono)' }}>{a.fiat}</span>
            </div>
          </div>
        ))}
      </div>
      <div className="m-bottomnav">
        <div className="m-navi"><MIcon name="wallet" size={20} /><span>Wallet</span></div>
        <div className="m-navi active"><MIcon name="list" size={20} /><span>Activity</span></div>
        <div className="m-navi"><MIcon name="arrow-left-right" size={20} /><span>Swap</span></div>
        <div className="m-navi"><MIcon name="shield-check" size={20} /><span>Security</span></div>
      </div>
    </div>
  );
}

function MobileApp() {
  return (
    <div className="m-stage">
      <div className="m-stage-head">
        <div className="m-stage-mark">
          <svg viewBox="0 0 64 64" width="22" height="22" style={{ color: 'var(--ink-1)' }}>
            <path d="M0 6 L 50 6 L 50 38 L 38 50 L 0 50 Z" fill="currentColor"/>
            <rect x="10" y="26" width="22" height="4" fill="var(--bg-canvas)"/>
          </svg>
          <span className="m-stage-title">SIMPLE · Mobile preview</span>
        </div>
        <div className="m-stage-meta">iOS · same brand language at touch scale</div>
      </div>
      <div className="m-frames">
        <div className="m-frame-wrap">
          <IOSDevice width={390} height={780}><MobileHome /></IOSDevice>
          <div className="m-frame-cap">Home</div>
        </div>
        <div className="m-frame-wrap">
          <IOSDevice width={390} height={780}><MobileSend /></IOSDevice>
          <div className="m-frame-cap">Send</div>
        </div>
        <div className="m-frame-wrap">
          <IOSDevice width={390} height={780}><MobileActivity /></IOSDevice>
          <div className="m-frame-cap">Activity</div>
        </div>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<MobileApp />);
