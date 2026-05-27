// SIMPLE — Extension UI Kit · shared atoms
// React must be loaded before this script. Lucide too (used for icons).

const { useState, useEffect, useRef, useCallback, createContext, useContext } = React;

// ============================================================
// Icon wrapper — uses Lucide via <i data-lucide=...> + createIcons.
// Refreshes any time component remounts.
// ============================================================
function Icon({ name, size = 16, stroke = 1.5, style }) {
  const ref = useRef(null);
  useEffect(() => {
    if (window.lucide && ref.current) {
      window.lucide.createIcons({ icons: window.lucide.icons, attrs: {}, nameAttr: 'data-lucide' });
    }
  });
  return <i ref={ref} data-lucide={name} style={{ width: size, height: size, display: 'inline-flex', strokeWidth: stroke, ...style }} />;
}

// ============================================================
// Account context — tracks active account, network, lock state.
// ============================================================
const SimpleCtx = createContext(null);

function SimpleProvider({ children, initial = {} }) {
  const [state, setState] = useState({
    account: { name: 'Main', address: '0x7d2F8Ac4e1B2c5D9384e0F7a8e3D4cb019a89aE1', avatar: 'ink-1' },
    network: { name: 'Ethereum', chainId: 1, color: 'secure' },
    locked: false,
    screen: 'home',
    navHistory: [],
    selectedToken: null,
    ...initial,
  });
  const go = useCallback((screen, payload = {}) => {
    setState(s => ({ ...s, screen, ...payload, navHistory: [...s.navHistory, s.screen] }));
  }, []);
  const back = useCallback(() => {
    setState(s => {
      const h = [...s.navHistory];
      const prev = h.pop() || 'home';
      return { ...s, screen: prev, navHistory: h };
    });
  }, []);
  return (
    <SimpleCtx.Provider value={{ ...state, set: setState, go, back }}>
      {children}
    </SimpleCtx.Provider>
  );
}

const useSimple = () => useContext(SimpleCtx);

// ============================================================
// Address helpers
// ============================================================
function shortAddr(a, head = 6, tail = 4) {
  if (!a) return '';
  return a.slice(0, head) + '…' + a.slice(-tail);
}

// ============================================================
// TopBar — account chip + address + network + actions
// ============================================================
function TopBar({ onMenu, onSearch, hideAddress }) {
  const s = useSimple();
  return (
    <div className="bar-top">
      <button className="acct-chip" onClick={() => s.go('accounts')}>
        <span className="av" />
        {s.account.name}
        <Icon name="chevron-down" size={12} style={{ color: 'var(--ink-3)' }} />
      </button>
      {!hideAddress && <span className="addr-mono">{shortAddr(s.account.address, 6, 4)}</span>}
      <span style={{ flex: 1 }} />
      <button className="net-chip" onClick={() => s.go('networks')}>
        <span className="dot" />
        {s.network.name}
      </button>
      <button className="icbtn" onClick={onSearch}><Icon name="search" /></button>
      <button className="icbtn" onClick={onMenu || (() => s.go('settings'))}><Icon name="menu" /></button>
    </div>
  );
}

// ============================================================
// SimpleHeader — page title bar (back + title + action)
// ============================================================
function SimpleHeader({ title, action, onBack }) {
  const s = useSimple();
  return (
    <div className="bar-top">
      <button className="icbtn" onClick={onBack || s.back}><Icon name="arrow-left" /></button>
      <div style={{ flex: 1, textAlign: 'center', font: '600 14px/1 var(--font-sans)', color: 'var(--ink-1)' }}>{title}</div>
      {action || <span style={{ width: 28 }} />}
    </div>
  );
}

// ============================================================
// BottomNav
// ============================================================
function BottomNav() {
  const s = useSimple();
  const items = [
    { id: 'home', name: 'Wallet', icon: 'wallet' },
    { id: 'activity', name: 'Activity', icon: 'list' },
    { id: 'swap', name: 'Swap', icon: 'arrow-left-right' },
    { id: 'security', name: 'Security', icon: 'shield-check' },
  ];
  return (
    <div className="bar-bottom">
      {items.map(it => (
        <button key={it.id} className={`nav-item ${s.screen === it.id ? 'active' : ''}`} onClick={() => s.go(it.id)}>
          <Icon name={it.icon} size={18} />
          {it.name}
        </button>
      ))}
    </div>
  );
}

// ============================================================
// ActionGrid — Send / Receive / Swap / Buy
// ============================================================
function ActionGrid() {
  const s = useSimple();
  return (
    <div className="actions">
      <button className="action" onClick={() => s.go('send')}><Icon name="arrow-up-right" /><span className="a-lbl">Send</span></button>
      <button className="action" onClick={() => s.go('receive')}><Icon name="arrow-down-left" /><span className="a-lbl">Receive</span></button>
      <button className="action" onClick={() => s.go('swap')}><Icon name="arrow-left-right" /><span className="a-lbl">Swap</span></button>
      <button className="action" onClick={() => s.go('buy')}><Icon name="plus" /><span className="a-lbl">Buy</span></button>
    </div>
  );
}

// ============================================================
// TokenRow / ActivityRow
// ============================================================
function TokenRow({ tok, onClick }) {
  return (
    <button className="row" onClick={onClick} style={{ width: '100%', background: 'transparent', border: 0, textAlign: 'left' }}>
      <div className={`tok ${tok.cls || ''}`}>{tok.symbol}</div>
      <div className="body">
        <div className="nm">{tok.name}</div>
        <div className="sub">
          <span style={{ fontFamily: 'var(--font-mono)' }}>{tok.amount} {tok.unit}</span>
          {tok.delta && <span style={{ color: tok.delta > 0 ? 'var(--secure)' : 'var(--danger)' }}> · {tok.delta > 0 ? '+' : ''}{tok.delta}%</span>}
        </div>
      </div>
      <div className="num">
        <div className="v">${tok.fiat}</div>
        <div className="q">${tok.price}</div>
      </div>
    </button>
  );
}

function ActivityRow({ act, onClick }) {
  const dirIcon = act.dir === 'send' ? 'arrow-up-right' : act.dir === 'receive' ? 'arrow-down-left' : act.dir === 'swap' ? 'arrow-left-right' : 'check';
  const statusColor = act.status === 'pending' ? 'var(--warn)' : act.status === 'failed' ? 'var(--danger)' : 'var(--ink-3)';
  return (
    <button className="row" onClick={onClick} style={{ width: '100%', background: 'transparent', border: 0, textAlign: 'left' }}>
      <div className="tok" style={{ background: 'var(--bg-sunken)', color: 'var(--ink-2)' }}>
        <Icon name={dirIcon} size={14} />
      </div>
      <div className="body">
        <div className="nm" style={{ textTransform: 'capitalize' }}>{act.dir}</div>
        <div className="sub">
          {act.status === 'pending' ? <span style={{ color: 'var(--warn)' }}>Pending · </span> : null}
          {act.target && <span style={{ fontFamily: 'var(--font-mono)' }}>{act.target}</span>}
          {act.time && <span style={{ color: statusColor }}> · {act.time}</span>}
        </div>
      </div>
      <div className="num">
        <div className="v" style={{ color: act.dir === 'send' ? 'var(--ink-1)' : 'var(--secure)' }}>
          {act.dir === 'send' ? '−' : '+'}{act.amount}
        </div>
        <div className="q">${act.fiat}</div>
      </div>
    </button>
  );
}

// ============================================================
// SettingsRow
// ============================================================
function SettingsRow({ icon, name, sub, right, onClick, danger }) {
  return (
    <div className="settings-row" onClick={onClick}>
      <div className="ic" style={{ color: danger ? 'var(--danger)' : 'var(--ink-2)' }}><Icon name={icon} /></div>
      <div className="body">
        <div className="nm" style={{ color: danger ? 'var(--danger)' : 'var(--ink-1)' }}>{name}</div>
        {sub && <div className="sub">{sub}</div>}
      </div>
      {right || <div className="chev"><Icon name="chevron-right" size={14} /></div>}
    </div>
  );
}

// ============================================================
// Pill
// ============================================================
function Pill({ kind = 'neutral', dot, children }) {
  return (
    <span className={`pill ${kind}`}>
      {dot && <span className="dot" style={{ background: `var(--${kind === 'neutral' ? 'ink-3' : kind})` }} />}
      {children}
    </span>
  );
}

// ============================================================
// ExtPopup — the 380x600 chrome
// ============================================================
function ExtPopup({ children, label }) {
  return (
    <div className="ext-popup" data-screen-label={label}>
      {children}
    </div>
  );
}

// ============================================================
// Sample data
// ============================================================
const SAMPLE_TOKENS = [
  { symbol: 'Ξ', name: 'Ethereum', amount: '0.4218', unit: 'ETH', fiat: '1,284.22', price: '3,042.18', delta: 1.2 },
  { symbol: '$', name: 'USD Coin', amount: '5,210.00', unit: 'USDC', fiat: '5,210.00', price: '1.00', cls: 'usdc' },
  { symbol: '₿', name: 'Bitcoin (wrapped)', amount: '0.082', unit: 'wBTC', fiat: '6,353.00', price: '77,476.83', cls: 'wbtc', delta: -0.8 },
  { symbol: 'U', name: 'Uniswap', amount: '32.5', unit: 'UNI', fiat: '281.20', price: '8.65', cls: 'uni', delta: 3.4 },
  { symbol: 'A', name: 'Arbitrum', amount: '1,120', unit: 'ARB', fiat: '892.16', price: '0.80', cls: 'arb', delta: -2.1 },
];

const SAMPLE_ACTIVITY = [
  { dir: 'receive', target: '0x9c4f…3a1b', amount: '0.05 ETH', fiat: '152.10', time: '12 min ago', status: 'confirmed' },
  { dir: 'send', target: '0x842a…7f0c', amount: '120 USDC', fiat: '120.00', time: '1 hr ago', status: 'pending' },
  { dir: 'swap', target: 'ETH → USDC', amount: '0.5 ETH', fiat: '1,521.09', time: 'Yesterday', status: 'confirmed' },
  { dir: 'send', target: '0xab12…9e34', amount: '0.01 ETH', fiat: '30.42', time: '2 days ago', status: 'confirmed' },
  { dir: 'receive', target: '0x7c89…1ab0', amount: '500 USDC', fiat: '500.00', time: '3 days ago', status: 'confirmed' },
];

// Expose to other scripts
Object.assign(window, {
  Icon, SimpleProvider, useSimple, shortAddr,
  TopBar, SimpleHeader, BottomNav, ActionGrid,
  TokenRow, ActivityRow, SettingsRow, Pill, ExtPopup,
  SAMPLE_TOKENS, SAMPLE_ACTIVITY,
});
