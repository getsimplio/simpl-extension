// SIMPLE — Extension UI Kit · app shell
// Renders all 9 screens in a wall, each independently interactive.

const { useState: useAppState, useEffect: useAppEffect } = React;

const SCREEN_MAP = {
  welcome: WelcomeScreen,
  unlock: UnlockScreen,
  home: HomeScreen,
  'asset-detail': AssetDetailScreen,
  send: SendScreen,
  receive: ReceiveScreen,
  activity: ActivityScreen,
  security: SecurityScreen,
  settings: SettingsScreen,
  swap: SwapScreen,
  accounts: AccountsScreen,
  networks: NetworksScreen,
  buy: BuyScreen,
};

// One scoped popup — has its own state. Clicking elsewhere navigates within itself.
function ScopedPopup({ initialScreen, caption }) {
  return (
    <div className="popup-tile">
      <SimpleProvider initial={{ screen: initialScreen }}>
        <ScopedRouter />
      </SimpleProvider>
      <div className="caption">{caption}</div>
    </div>
  );
}

function ScopedRouter() {
  const s = useSimple();
  const Screen = SCREEN_MAP[s.screen] || HomeScreen;
  return <Screen />;
}

function App() {
  // Re-run lucide on every render in case new icons appeared.
  useAppEffect(() => {
    const interval = setInterval(() => { if (window.lucide) window.lucide.createIcons(); }, 250);
    return () => clearInterval(interval);
  }, []);

  const tiles = [
    { id: 'welcome', label: '01 · Welcome' },
    { id: 'unlock', label: '02 · Unlock' },
    { id: 'home', label: '03 · Home' },
    { id: 'asset-detail', label: '04 · Asset detail' },
    { id: 'send', label: '05 · Send' },
    { id: 'receive', label: '06 · Receive' },
    { id: 'activity', label: '07 · Activity' },
    { id: 'security', label: '08 · Security' },
    { id: 'settings', label: '09 · Settings' },
  ];

  return (
    <div className="kit-root">
      <div className="kit-header">
        <div className="kit-mark">
          <svg viewBox="0 0 64 64" width="24" height="24" style={{ color: 'var(--ink-1)' }}>
            <path d="M0 6 L 50 6 L 50 38 L 38 50 L 0 50 Z" fill="currentColor"/>
            <rect x="10" y="26" width="22" height="4" fill="var(--bg-canvas)"/>
          </svg>
          <span className="kit-title">SIMPLE · Chrome Extension</span>
        </div>
        <div className="kit-meta">380 × 600 popup · 9 screens · click any to interact</div>
      </div>
      <div className="kit-wall">
        {tiles.map(t => <ScopedPopup key={t.id} initialScreen={t.id} caption={t.label} />)}
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
