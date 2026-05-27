// SIMPLE — Web Dashboard preview
// Single-file React component. Larger surface; same brand language.

const { useState: useDState, useEffect: useDEffect } = React;

function Icon({ name, size = 16 }) {
  useDEffect(() => { if (window.lucide) window.lucide.createIcons(); });
  return <i data-lucide={name} style={{ width: size, height: size, display: 'inline-flex' }} />;
}

const TOKENS = [
  { sym: 'Ξ', cls: 'eth', name: 'Ethereum', qty: '0.4218 ETH', fiat: '1,284.22', price: '3,042.18', d1: '+1.2%', up: true, chart: 'M0 38 L 30 32 L 60 36 L 90 22 L 120 26 L 150 18 L 180 24 L 220 14 L 250 18 L 300 10' },
  { sym: '$', cls: 'usdc', name: 'USD Coin', qty: '5,210.00 USDC', fiat: '5,210.00', price: '1.00', d1: '+0.0%', up: true, chart: 'M0 24 L 50 25 L 100 24 L 150 24 L 200 23 L 250 24 L 300 24' },
  { sym: '₿', cls: 'wbtc', name: 'Bitcoin (wrapped)', qty: '0.082 wBTC', fiat: '6,353.00', price: '77,476.83', d1: '−0.8%', up: false, chart: 'M0 14 L 40 18 L 80 16 L 120 22 L 160 18 L 200 26 L 240 22 L 300 30' },
  { sym: 'U', cls: 'uni', name: 'Uniswap', qty: '32.5 UNI', fiat: '281.20', price: '8.65', d1: '+3.4%', up: true, chart: 'M0 30 L 40 28 L 80 24 L 120 26 L 160 20 L 200 16 L 240 14 L 300 8' },
  { sym: 'A', cls: 'arb', name: 'Arbitrum', qty: '1,120 ARB', fiat: '892.16', price: '0.80', d1: '−2.1%', up: false, chart: 'M0 18 L 40 16 L 80 22 L 120 20 L 160 26 L 200 24 L 240 30 L 300 28' },
  { sym: 'O', cls: 'op', name: 'Optimism', qty: '210 OP', fiat: '420.50', price: '2.00', d1: '+0.6%', up: true, chart: 'M0 26 L 40 26 L 80 22 L 120 24 L 160 18 L 200 22 L 240 18 L 300 16' },
];

const ACTIVITY = [
  { dir: 'receive', label: 'Receive · ETH', from: '0x9c4f3a1bd827e0fE…3a1b', amt: '+0.05 ETH', fiat: '+$152.10', time: '12 min', status: 'Confirmed' },
  { dir: 'send', label: 'Send · USDC', from: '0x842a8E1c4F90c0B5…7f0c', amt: '−120.00 USDC', fiat: '−$120.00', time: '1 hr', status: 'Pending' },
  { dir: 'swap', label: 'Swap · ETH → USDC', from: 'via 0x', amt: '0.5 ETH → 1,521 USDC', fiat: '$1,521.09', time: 'Yesterday', status: 'Confirmed' },
  { dir: 'send', label: 'Send · ETH', from: '0xab1283fE…9e34', amt: '−0.01 ETH', fiat: '−$30.42', time: '2 days', status: 'Confirmed' },
  { dir: 'receive', label: 'Receive · USDC', from: '0x7c894dE9…1ab0', amt: '+500.00 USDC', fiat: '+$500.00', time: '3 days', status: 'Confirmed' },
];

function Dashboard() {
  const [tab, setTab] = useDState('overview');
  const [theme, setTheme] = useDState('light');
  useDEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return (
    <div className={`dash ${theme}`} data-theme={theme}>
      {/* Sidebar */}
      <aside className="dash-sidebar">
        <div className="dash-brand">
          <svg viewBox="0 0 64 64" width="20" height="20" style={{ color: 'var(--ink-1)' }}>
            <path d="M0 6 L 50 6 L 50 38 L 38 50 L 0 50 Z" fill="currentColor"/>
            <rect x="10" y="26" width="22" height="4" fill="var(--bg-canvas)"/>
          </svg>
          <span className="wordmark">SIMPLE</span>
        </div>

        <div className="acct-block">
          <div className="acct-row">
            <div className="av" />
            <div className="acct-meta">
              <div className="nm">Main</div>
              <div className="addr">0x7d2F…9aE1</div>
            </div>
            <button className="icbtn"><Icon name="chevron-down" size={14} /></button>
          </div>
          <div className="acct-balance">$12,847.<span className="cents">22</span></div>
          <div className="acct-delta">+$144.20 · 1.2% today</div>
        </div>

        <nav className="dash-nav">
          {[
            ['overview', 'layout-grid', 'Overview'],
            ['portfolio', 'wallet', 'Portfolio'],
            ['activity', 'list', 'Activity'],
            ['swap', 'arrow-left-right', 'Swap'],
            ['nft', 'image', 'Collectibles'],
            ['security', 'shield-check', 'Security'],
            ['connections', 'link-2', 'Connections'],
          ].map(([id, ic, lbl]) => (
            <button key={id} className={`nav-link ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>
              <Icon name={ic} size={16} /> {lbl}
            </button>
          ))}
        </nav>

        <div className="sidebar-foot">
          <button className="nav-link"><Icon name="settings" size={16} /> Settings</button>
          <button className="nav-link" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>
            <Icon name={theme === 'light' ? 'moon' : 'sun'} size={16} /> {theme === 'light' ? 'Dark' : 'Light'} mode
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="dash-main">
        <header className="dash-header">
          <div>
            <div className="overline">Portfolio</div>
            <h1 className="t-h1" style={{ fontSize: 32 }}>Overview</h1>
          </div>
          <div className="dash-actions">
            <div className="search">
              <Icon name="search" size={14} />
              <input placeholder="Search assets, addresses, txns…" />
              <kbd>⌘ K</kbd>
            </div>
            <button className="net-chip"><span className="dot" />Ethereum<Icon name="chevron-down" size={12} /></button>
            <button className="btn primary">Send</button>
            <button className="btn secondary">Receive</button>
          </div>
        </header>

        {/* Top metrics */}
        <section className="metric-row">
          <div className="metric">
            <div className="m-lbl">Total balance</div>
            <div className="m-val">$12,847.<span style={{color:'var(--ink-3)'}}>22</span></div>
            <div className="m-sub up">+$144.20 · 1.2% today</div>
          </div>
          <div className="metric">
            <div className="m-lbl">24h change</div>
            <div className="m-val">+$144.<span style={{color:'var(--ink-3)'}}>20</span></div>
            <div className="m-sub up">+1.18% across 6 assets</div>
          </div>
          <div className="metric">
            <div className="m-lbl">Gas · Ethereum</div>
            <div className="m-val">12<span style={{color:'var(--ink-3)', fontSize:18, marginLeft:6}}>gwei</span></div>
            <div className="m-sub">$0.42 standard transfer</div>
          </div>
          <div className="metric">
            <div className="m-lbl">Security</div>
            <div className="m-val" style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 24 }}>
              <Icon name="shield-check" size={22} /> Healthy
            </div>
            <div className="m-sub" style={{ color: 'var(--secure)' }}>4 / 4 checks passed</div>
          </div>
        </section>

        {/* Chart */}
        <section className="chart-card">
          <div className="chart-head">
            <div>
              <div className="m-lbl">Portfolio · 30d</div>
              <div className="chart-val">$12,847.22</div>
            </div>
            <div className="chart-tabs">
              {['1H','1D','1W','1M','3M','1Y','All'].map((p, i) => (
                <button key={p} className={i === 3 ? 'active' : ''}>{p}</button>
              ))}
            </div>
          </div>
          <svg className="chart-svg" viewBox="0 0 1000 180" preserveAspectRatio="none">
            <defs>
              <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--ink-1)" stopOpacity="0.12" />
                <stop offset="100%" stopColor="var(--ink-1)" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d="M0 130 L 50 122 L 100 128 L 150 110 L 200 116 L 250 92 L 300 100 L 350 82 L 400 88 L 450 70 L 500 78 L 550 60 L 600 66 L 650 50 L 700 56 L 750 42 L 800 48 L 850 36 L 900 40 L 950 32 L 1000 38"
                  fill="none" stroke="var(--ink-1)" strokeWidth="1.5" />
            <path d="M0 130 L 50 122 L 100 128 L 150 110 L 200 116 L 250 92 L 300 100 L 350 82 L 400 88 L 450 70 L 500 78 L 550 60 L 600 66 L 650 50 L 700 56 L 750 42 L 800 48 L 850 36 L 900 40 L 950 32 L 1000 38 L 1000 180 L 0 180 Z"
                  fill="url(#g1)" />
          </svg>
        </section>

        {/* Assets table */}
        <section className="table-card">
          <div className="table-head">
            <div className="t-h3">Assets</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="filter-pill active">All · 6</button>
              <button className="filter-pill">DeFi</button>
              <button className="filter-pill">Stables</button>
              <button className="filter-pill">+ Hide small</button>
            </div>
          </div>
          <table className="assets-table">
            <thead>
              <tr>
                <th>Asset</th>
                <th>Holdings</th>
                <th>Price</th>
                <th>24h</th>
                <th>30d</th>
                <th style={{ textAlign: 'right' }}>Value</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {TOKENS.map((t, i) => (
                <tr key={i}>
                  <td><div className="asset-cell"><div className={`tok ${t.cls}`}>{t.sym}</div><div><div className="nm">{t.name}</div><div className="sub">{t.qty}</div></div></div></td>
                  <td className="mono">{t.qty.split(' ')[0]}</td>
                  <td className="mono">${t.price}</td>
                  <td className={`mono ${t.up ? 'up' : 'down'}`}>{t.d1}</td>
                  <td>
                    <svg viewBox="0 0 300 40" width="120" height="32" preserveAspectRatio="none">
                      <path d={t.chart} fill="none" stroke={t.up ? 'var(--secure)' : 'var(--danger)'} strokeWidth="1.25" />
                    </svg>
                  </td>
                  <td className="mono" style={{ textAlign: 'right' }}>${t.fiat}</td>
                  <td><button className="icbtn"><Icon name="more-horizontal" size={14} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {/* Activity */}
        <section className="table-card">
          <div className="table-head">
            <div className="t-h3">Recent activity</div>
            <button className="link">View all <Icon name="arrow-right" size={12} /></button>
          </div>
          <table className="assets-table">
            <tbody>
              {ACTIVITY.map((a, i) => (
                <tr key={i}>
                  <td>
                    <div className="asset-cell">
                      <div className="tok act">
                        <Icon name={a.dir === 'send' ? 'arrow-up-right' : a.dir === 'receive' ? 'arrow-down-left' : 'arrow-left-right'} size={14} />
                      </div>
                      <div><div className="nm">{a.label}</div><div className="sub mono">{a.from}</div></div>
                    </div>
                  </td>
                  <td className="mono" style={{ color: 'var(--ink-1)' }}>{a.amt}</td>
                  <td className="mono">{a.fiat}</td>
                  <td>
                    <span className={`pill ${a.status === 'Pending' ? 'warn' : 'secure'}`}>
                      <span className="dot" /> {a.status}
                    </span>
                  </td>
                  <td className="mono" style={{ color: 'var(--ink-3)' }}>{a.time} ago</td>
                  <td style={{ textAlign: 'right' }}><button className="icbtn"><Icon name="external-link" size={14} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </main>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<Dashboard />);
