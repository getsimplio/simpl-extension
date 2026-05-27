// SIMPLE — Extension screens (part 2): Receive, Activity, Security, Settings + light screens

const { useState: useState2 } = React;

// ============================================================
// 6. Receive
// ============================================================
function ReceiveScreen() {
  const s = useSimple();
  const addr = s.account.address;
  // Minimal QR pattern — a static SVG placeholder. Real impl would render QR.
  return (
    <ExtPopup label="06 Receive">
      <SimpleHeader title="Receive" />
      <div className="screen-body" style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'center' }}>
        <div style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'var(--bg-sunken)', borderRadius: 6 }}>
          <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>Network</span>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 12, color: 'var(--ink-1)', fontWeight: 500 }}>Ethereum Mainnet</span>
          <Icon name="chevron-down" size={12} style={{ color: 'var(--ink-3)' }} />
        </div>
        <div style={{ width: 200, height: 200, background: '#fff', border: '1px solid var(--line)', borderRadius: 8, padding: 12 }}>
          <svg viewBox="0 0 25 25" style={{ width: '100%', height: '100%', display: 'block' }} shapeRendering="crispEdges">
            {/* Generated faux-QR pattern */}
            {(() => {
              const seed = addr.toLowerCase();
              const cells = [];
              for (let y = 0; y < 25; y++) for (let x = 0; x < 25; x++) {
                // finder squares
                const inFinder = (
                  (x < 7 && y < 7) || (x > 17 && y < 7) || (x < 7 && y > 17)
                );
                if (inFinder) {
                  const fx = x < 7 ? x : x - 18;
                  const fy = y < 7 ? y : y - 18;
                  const on = (fx === 0 || fx === 6 || fy === 0 || fy === 6) || (fx >= 2 && fx <= 4 && fy >= 2 && fy <= 4);
                  if (on) cells.push(<rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill="#14140F" />);
                  continue;
                }
                const c = seed.charCodeAt((x * 31 + y * 7) % seed.length);
                if ((c + x + y) % 3 === 0) cells.push(<rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill="#14140F" />);
              }
              return cells;
            })()}
          </svg>
        </div>
        <div style={{ width: '100%', padding: '10px 12px', background: 'var(--bg-surface)', border: '1px solid var(--line)', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-2)', wordBreak: 'break-all', lineHeight: 1.45 }}>{addr}</span>
        </div>
        <div style={{ display: 'flex', gap: 6, width: '100%' }}>
          <button className="btn secondary full"><Icon name="copy" size={14} /> Copy</button>
          <button className="btn secondary full"><Icon name="share-2" size={14} /> Share</button>
        </div>
        <div style={{ fontSize: 11, color: 'var(--ink-3)', textAlign: 'center', lineHeight: 1.5, marginTop: 4 }}>
          Only send Ethereum or ERC-20 tokens to this address. Other assets may be lost.
        </div>
      </div>
    </ExtPopup>
  );
}

// ============================================================
// 7. Activity
// ============================================================
function ActivityScreen() {
  const [filter, setFilter] = useState2('all');
  const filters = [['all', 'All'], ['send', 'Sent'], ['receive', 'Received'], ['swap', 'Swaps']];
  const items = filter === 'all' ? SAMPLE_ACTIVITY : SAMPLE_ACTIVITY.filter(a => a.dir === filter);
  return (
    <ExtPopup label="07 Activity">
      <TopBar />
      <div className="screen-body">
        <div style={{ padding: '14px 16px 8px' }}>
          <div className="t-h2">Activity</div>
          <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>24 transactions · this account</div>
        </div>
        <div style={{ display: 'flex', gap: 4, padding: '0 12px 8px' }}>
          {filters.map(([id, lbl]) => (
            <button key={id} onClick={() => setFilter(id)} style={{
              padding: '5px 10px', fontSize: 11, fontWeight: 500,
              background: filter === id ? 'var(--ink-1)' : 'transparent',
              color: filter === id ? 'var(--ink-on-dark)' : 'var(--ink-2)',
              border: filter === id ? 0 : '1px solid var(--line-strong)',
              borderRadius: 999, cursor: 'pointer', fontFamily: 'var(--font-sans)',
            }}>{lbl}</button>
          ))}
        </div>
        <div style={{ padding: '0 8px 8px' }}>
          <div style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-3)', padding: '6px 10px' }}>Today</div>
          {items.slice(0, 2).map((a, i) => <ActivityRow key={i} act={a} />)}
          <div style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-3)', padding: '10px 10px 4px' }}>Earlier</div>
          {items.slice(2).map((a, i) => <ActivityRow key={i + 10} act={a} />)}
        </div>
      </div>
      <BottomNav />
    </ExtPopup>
  );
}

// ============================================================
// 8. Security
// ============================================================
function SecurityScreen() {
  return (
    <ExtPopup label="08 Security">
      <TopBar />
      <div className="screen-body">
        <div style={{ padding: '14px 16px 12px' }}>
          <div className="t-h2">Security</div>
          <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>Your account&apos;s safety checks</div>
        </div>
        <div style={{ margin: '0 12px 14px', padding: 14, border: '1px solid var(--line)', borderRadius: 8, background: 'var(--bg-surface)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <Icon name="shield-check" size={16} style={{ color: 'var(--secure)' }} />
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-1)' }}>Wallet healthy</span>
            <span style={{ flex: 1 }} />
            <Pill kind="secure" dot>4 / 4</Pill>
          </div>
          {[
            ['Recovery phrase backed up', true],
            ['Password set', true],
            ['No risky approvals', true],
            ['Auto-lock enabled · 5 min', true],
          ].map(([lbl, ok]) => (
            <div key={lbl} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderTop: '1px solid var(--line)' }}>
              <Icon name={ok ? 'check' : 'x'} size={14} style={{ color: ok ? 'var(--secure)' : 'var(--danger)' }} />
              <span style={{ fontSize: 12, color: 'var(--ink-2)' }}>{lbl}</span>
            </div>
          ))}
        </div>
        <div className="settings-group">
          <SettingsRow icon="key" name="Reveal recovery phrase" sub="Requires password" />
          <SettingsRow icon="lock" name="Change password" />
          <SettingsRow icon="clock" name="Auto-lock" sub="5 minutes" right={<span style={{ fontSize: 12, color: 'var(--ink-3)' }}>5 min ›</span>} />
          <SettingsRow icon="fingerprint" name="Biometric unlock" right={<div className="toggle off" />} />
        </div>
        <div className="settings-group">
          <SettingsRow icon="link-2" name="Connected sites" sub="3 dApps" />
          <SettingsRow icon="check-circle" name="Token approvals" sub="2 active · 1 unlimited" />
        </div>
      </div>
      <BottomNav />
    </ExtPopup>
  );
}

// ============================================================
// 9. Settings
// ============================================================
function SettingsScreen() {
  const s = useSimple();
  return (
    <ExtPopup label="09 Settings">
      <SimpleHeader title="Settings" />
      <div className="screen-body">
        <div style={{ padding: '12px 16px 8px', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 36, height: 36, borderRadius: 999, background: 'var(--ink-1)' }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-1)' }}>{s.account.name}</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-3)' }}>{shortAddr(s.account.address, 8, 6)}</div>
          </div>
          <button className="btn secondary sm" style={{ height: 28, fontSize: 11, padding: '0 10px' }}>Edit</button>
        </div>
        <div style={{ padding: '6px 16px 14px', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>General</div>
        <div className="settings-group">
          <SettingsRow icon="user" name="Accounts" sub="3 accounts · 1 hardware" />
          <SettingsRow icon="globe" name="Networks" sub="Ethereum, Base, Arbitrum + 4" />
          <SettingsRow icon="link-2" name="Connections" sub="3 connected sites" />
          <SettingsRow icon="bell" name="Notifications" right={<div className="toggle" />} />
        </div>
        <div style={{ padding: '6px 16px 8px', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>Display</div>
        <div className="settings-group">
          <SettingsRow icon="moon" name="Theme" right={<span style={{ fontSize: 12, color: 'var(--ink-3)' }}>System ›</span>} />
          <SettingsRow icon="dollar-sign" name="Currency" right={<span style={{ fontSize: 12, color: 'var(--ink-3)' }}>USD ›</span>} />
          <SettingsRow icon="languages" name="Language" right={<span style={{ fontSize: 12, color: 'var(--ink-3)' }}>English ›</span>} />
        </div>
        <div style={{ padding: '6px 16px 8px', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>Advanced</div>
        <div className="settings-group">
          <SettingsRow icon="shield" name="Security" onClick={() => s.go('security')} />
          <SettingsRow icon="info" name="About SIMPLE" sub="v 0.4.2" />
          <SettingsRow icon="log-out" name="Lock wallet" danger onClick={() => s.set(p => ({ ...p, locked: true, screen: 'unlock' }))} />
        </div>
        <div style={{ padding: '0 16px 20px', textAlign: 'center', fontSize: 10, color: 'var(--ink-4)', fontFamily: 'var(--font-mono)' }}>SIMPLE v 0.4.2 · build 2026.05</div>
      </div>
    </ExtPopup>
  );
}

// ============================================================
// Stubs: swap, buy, accounts list, networks list
// ============================================================
function SwapScreen() {
  return (
    <ExtPopup label="Swap">
      <SimpleHeader title="Swap" />
      <div className="screen-body" style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ padding: 14, background: 'var(--bg-surface)', border: '1px solid var(--line)', borderRadius: 8 }}>
          <div style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>From</div>
          <div style={{ display: 'flex', alignItems: 'center', marginTop: 6 }}>
            <div style={{ fontSize: 28, fontFamily: 'var(--font-display)', fontWeight: 500, letterSpacing: '-0.01em' }}>0.5</div>
            <span style={{ flex: 1 }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', background: 'var(--bg-sunken)', borderRadius: 999 }}>
              <span style={{ width: 18, height: 18, borderRadius: 999, background: 'var(--ink-1)', color: 'var(--ink-on-dark)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9 }}>Ξ</span>
              <span style={{ fontSize: 13, fontWeight: 500 }}>ETH</span>
              <Icon name="chevron-down" size={12} style={{ color: 'var(--ink-3)' }} />
            </div>
          </div>
          <div style={{ fontSize: 11, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)', marginTop: 4 }}>≈ $1,521.09 · balance 0.4218</div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', margin: '-12px 0' }}>
          <div style={{ width: 30, height: 30, borderRadius: 999, background: 'var(--bg-canvas)', border: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', zIndex: 1 }}>
            <Icon name="arrow-down" size={14} />
          </div>
        </div>
        <div style={{ padding: 14, background: 'var(--bg-surface)', border: '1px solid var(--line)', borderRadius: 8 }}>
          <div style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>To</div>
          <div style={{ display: 'flex', alignItems: 'center', marginTop: 6 }}>
            <div style={{ fontSize: 28, fontFamily: 'var(--font-display)', fontWeight: 500, letterSpacing: '-0.01em', color: 'var(--ink-1)' }}>1,521.09</div>
            <span style={{ flex: 1 }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', background: 'var(--bg-sunken)', borderRadius: 999 }}>
              <span style={{ width: 18, height: 18, borderRadius: 999, background: '#2C5C8F', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10 }}>$</span>
              <span style={{ fontSize: 13, fontWeight: 500 }}>USDC</span>
              <Icon name="chevron-down" size={12} style={{ color: 'var(--ink-3)' }} />
            </div>
          </div>
          <div style={{ fontSize: 11, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)', marginTop: 4 }}>1 ETH = 3,042.18 USDC · via 0x</div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 12px', background: 'var(--bg-sunken)', borderRadius: 6, marginTop: 6, fontSize: 11 }}>
          <span style={{ color: 'var(--ink-3)' }}>Network fee · slippage 0.5%</span>
          <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--ink-1)' }}>$0.42</span>
        </div>
        <div style={{ flex: 1 }} />
        <button className="btn primary lg full">Review swap</button>
      </div>
      <BottomNav />
    </ExtPopup>
  );
}

function AccountsScreen() {
  const s = useSimple();
  const accounts = [
    { name: 'Main', address: '0x7d2F8Ac4e1B2c5D9384e0F7a8e3D4cb019a89aE1', balance: '$10,128.12', active: true },
    { name: 'Trading', address: '0x4a8B7c0E92C5a14d83f0c1eAb71e8d2C0f5Df81B', balance: '$2,234.40', active: false },
    { name: 'Ledger', address: '0x9c2F1aD4cD32e87aB1f0eF0a5f6e7C0bA98D72e1', balance: '$485.00', hardware: true, active: false },
  ];
  return (
    <ExtPopup label="Accounts">
      <SimpleHeader title="Accounts" action={<button className="icbtn"><Icon name="plus" /></button>} />
      <div className="screen-body" style={{ padding: '8px 12px' }}>
        <div className="settings-group" style={{ margin: 0 }}>
          {accounts.map((a, i) => (
            <div key={i} className="settings-row" onClick={() => s.set(p => ({ ...p, account: a, screen: 'home' }))}>
              <div style={{ width: 28, height: 28, borderRadius: 999, background: a.active ? 'var(--ink-1)' : 'var(--bg-sunken)', border: a.active ? 0 : '1px solid var(--line-strong)' }} />
              <div className="body">
                <div className="nm" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {a.name}
                  {a.hardware && <Pill kind="neutral">Ledger</Pill>}
                </div>
                <div className="sub" style={{ fontFamily: 'var(--font-mono)' }}>{shortAddr(a.address, 8, 6)}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--ink-1)' }}>{a.balance}</div>
                {a.active && <div style={{ fontSize: 10, color: 'var(--secure)', marginTop: 2 }}>● Active</div>}
              </div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
          <button className="btn secondary full"><Icon name="plus" size={14} /> New account</button>
          <button className="btn secondary full"><Icon name="hard-drive" size={14} /> Connect hardware</button>
        </div>
      </div>
    </ExtPopup>
  );
}

function NetworksScreen() {
  const s = useSimple();
  const nets = [
    { name: 'Ethereum', chainId: 1, active: true },
    { name: 'Base', chainId: 8453, active: false },
    { name: 'Arbitrum', chainId: 42161, active: false },
    { name: 'Optimism', chainId: 10, active: false },
    { name: 'Polygon', chainId: 137, active: false },
    { name: 'Sepolia (testnet)', chainId: 11155111, active: false, testnet: true },
  ];
  return (
    <ExtPopup label="Networks">
      <SimpleHeader title="Networks" action={<button className="icbtn"><Icon name="plus" /></button>} />
      <div className="screen-body" style={{ padding: '8px 12px' }}>
        <div className="settings-group" style={{ margin: 0 }}>
          {nets.map((n, i) => (
            <div key={i} className="settings-row" onClick={() => s.set(p => ({ ...p, network: n, screen: 'home' }))}>
              <div style={{ width: 24, height: 24, borderRadius: 999, background: n.active ? 'var(--secure)' : 'var(--bg-sunken)', border: n.active ? 0 : '1px solid var(--line-strong)' }} />
              <div className="body">
                <div className="nm" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {n.name}
                  {n.testnet && <Pill kind="warn">Testnet</Pill>}
                </div>
                <div className="sub" style={{ fontFamily: 'var(--font-mono)' }}>chain {n.chainId}</div>
              </div>
              {n.active ? <Icon name="check" size={14} style={{ color: 'var(--ink-1)' }} /> : <div style={{ width: 14 }} />}
            </div>
          ))}
        </div>
      </div>
    </ExtPopup>
  );
}

function BuyScreen() {
  return (
    <ExtPopup label="Buy">
      <SimpleHeader title="Buy crypto" />
      <div className="screen-body" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5 }}>Buy directly to your wallet via a partner. SIMPLE does not custody the funds.</div>
        {[
          { name: 'Coinbase Pay', fee: '~1.5%', methods: 'Card · ACH' },
          { name: 'MoonPay', fee: '~3.5%', methods: 'Card · SEPA' },
          { name: 'Stripe', fee: '~2.2%', methods: 'Card' },
        ].map(p => (
          <button key={p.name} className="settings-row" style={{ borderRadius: 8, border: '1px solid var(--line)' }}>
            <div className="ic"><Icon name="credit-card" /></div>
            <div className="body"><div className="nm">{p.name}</div><div className="sub">{p.methods} · fee {p.fee}</div></div>
            <Icon name="external-link" size={14} style={{ color: 'var(--ink-3)' }} />
          </button>
        ))}
      </div>
      <BottomNav />
    </ExtPopup>
  );
}

Object.assign(window, { ReceiveScreen, ActivityScreen, SecurityScreen, SettingsScreen, SwapScreen, AccountsScreen, NetworksScreen, BuyScreen });
