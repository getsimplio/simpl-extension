// SIMPLE — Extension screens (part 1): Welcome, Unlock, Home, AssetDetail, Send

const { useState: useState1, useEffect: useEffect1 } = React;

// ============================================================
// 1. Welcome / onboarding
// ============================================================
function WelcomeScreen() {
  const s = useSimple();
  const [stage, setStage] = useState1('hello'); // hello → create → seed → confirm → done

  if (stage === 'hello') return (
    <ExtPopup label="01 Welcome">
      <div className="screen-body" style={{ padding: '40px 24px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <svg viewBox="0 0 64 64" width="44" height="44" style={{ color: 'var(--ink-1)' }}>
          <path d="M0 6 L 50 6 L 50 38 L 38 50 L 0 50 Z" fill="currentColor"/>
          <rect x="10" y="26" width="22" height="4" fill="var(--bg-canvas)"/>
        </svg>
        <div className="t-display" style={{ fontSize: 36, marginTop: 16, lineHeight: 1.05 }}>
          Control your assets<br />without the noise.
        </div>
        <div style={{ color: 'var(--ink-3)', fontSize: 13, lineHeight: 1.55, marginTop: 8 }}>
          A non-custodial EVM wallet. Your keys live on this device — never on a server.
        </div>
        <div style={{ flex: 1 }} />
        <button className="btn primary lg full" onClick={() => setStage('create')}>Create new wallet</button>
        <button className="btn secondary lg full">I already have a wallet</button>
        <div style={{ fontSize: 11, color: 'var(--ink-3)', textAlign: 'center', marginTop: 8 }}>
          By continuing you accept the <u>Terms</u> and <u>Privacy Notice</u>.
        </div>
      </div>
    </ExtPopup>
  );

  if (stage === 'create') return (
    <ExtPopup label="01 Welcome · Create password">
      <SimpleHeader title="Create password" onBack={() => setStage('hello')} />
      <div className="screen-body" style={{ padding: '20px 16px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ color: 'var(--ink-2)', fontSize: 13, lineHeight: 1.5 }}>
          This password unlocks the wallet on this device only. We can&apos;t recover it.
        </div>
        <div>
          <span className="field-label">Password</span>
          <input className="input lg" type="password" defaultValue="••••••••••••" />
        </div>
        <div>
          <span className="field-label">Confirm password</span>
          <input className="input lg" type="password" defaultValue="••••••••••••" />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 6, background: 'var(--bg-surface)' }}>
          <div className="toggle" />
          <div style={{ fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.4 }}>I understand SIMPLE cannot recover this password for me.</div>
        </div>
        <div style={{ flex: 1 }} />
        <button className="btn primary lg full" onClick={() => setStage('seed')}>Continue</button>
      </div>
    </ExtPopup>
  );

  if (stage === 'seed') return (
    <ExtPopup label="01 Welcome · Recovery phrase">
      <SimpleHeader title="Recovery phrase" onBack={() => setStage('create')} />
      <div className="screen-body" style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', gap: 8, padding: '10px 12px', background: 'var(--warn-soft)', borderRadius: 6, alignItems: 'flex-start' }}>
          <Icon name="alert-triangle" size={14} style={{ color: 'var(--warn)', marginTop: 2 }} />
          <div style={{ fontSize: 12, color: 'var(--warn)', lineHeight: 1.45 }}>Write these 12 words in order, somewhere offline. Anyone with this phrase controls the wallet.</div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, padding: 12, background: 'var(--bg-surface)', border: '1px solid var(--line)', borderRadius: 8 }}>
          {['quiet', 'orbit', 'paper', 'cipher', 'north', 'gravel', 'ladder', 'rotate', 'silent', 'bronze', 'window', 'anchor'].map((w, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '4px 0' }}>
              <span style={{ fontSize: 10, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)', minWidth: 14 }}>{String(i + 1).padStart(2, '0')}</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--ink-1)' }}>{w}</span>
            </div>
          ))}
        </div>
        <button className="btn secondary full" style={{ marginTop: 4 }}>
          <Icon name="copy" size={14} /> Copy to clipboard
        </button>
        <div style={{ flex: 1 }} />
        <button className="btn primary lg full" onClick={() => s.set(p => ({ ...p, screen: 'home' }))}>I&apos;ve saved it</button>
      </div>
    </ExtPopup>
  );

  return null;
}

// ============================================================
// 2. Unlock
// ============================================================
function UnlockScreen() {
  const s = useSimple();
  return (
    <ExtPopup label="02 Unlock">
      <div className="screen-body" style={{ padding: '60px 24px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
        <svg viewBox="0 0 64 64" width="40" height="40" style={{ color: 'var(--ink-1)' }}>
          <path d="M0 6 L 50 6 L 50 38 L 38 50 L 0 50 Z" fill="currentColor"/>
          <rect x="10" y="26" width="22" height="4" fill="var(--bg-canvas)"/>
        </svg>
        <div className="t-h2" style={{ marginTop: 12 }}>Welcome back</div>
        <div style={{ color: 'var(--ink-3)', fontSize: 13 }}>Enter your password to unlock.</div>
        <div style={{ width: '100%', marginTop: 32 }}>
          <input className="input lg" type="password" defaultValue="••••••••••••" />
        </div>
        <button className="btn primary lg full" style={{ marginTop: 8 }} onClick={() => s.set(p => ({ ...p, locked: false, screen: 'home' }))}>
          <Icon name="unlock" size={14} /> Unlock
        </button>
        <button className="btn ghost" style={{ marginTop: 'auto', fontSize: 12, color: 'var(--ink-3)' }}>
          Forgot password · restore from phrase
        </button>
      </div>
    </ExtPopup>
  );
}

// ============================================================
// 3. Home / portfolio
// ============================================================
function HomeScreen() {
  const s = useSimple();
  const [tab, setTab] = useState1('tokens');
  return (
    <ExtPopup label="03 Home">
      <TopBar />
      <div className="screen-body">
        <div className="balance-block">
          <div className="lbl">Total balance</div>
          <div className="val">$12,847.<span className="cents">22</span></div>
          <div className="delta">
            <span className="up">+$144.20</span> · 1.2% today
            <span style={{ marginLeft: 10, padding: '1px 6px', background: 'var(--secure-soft)', color: 'var(--secure)', borderRadius: 3, fontSize: 10, letterSpacing: '0.04em', textTransform: 'uppercase', fontFamily: 'var(--font-sans)' }}>● Secure</span>
          </div>
        </div>
        <ActionGrid />
        <div style={{ padding: '0 12px', display: 'flex', gap: 4, marginBottom: 6 }}>
          {[['tokens', 'Tokens'], ['nfts', 'NFTs'], ['activity', 'Activity']].map(([id, lbl]) => (
            <button key={id}
              onClick={() => id === 'activity' ? s.go('activity') : setTab(id)}
              style={{
                padding: '6px 10px', fontSize: 12, fontWeight: 500,
                background: tab === id ? 'var(--bg-active)' : 'transparent',
                color: tab === id ? 'var(--ink-1)' : 'var(--ink-3)',
                border: 0, borderRadius: 4, cursor: 'pointer', fontFamily: 'var(--font-sans)',
              }}>
              {lbl}
            </button>
          ))}
        </div>
        <div className="row-list">
          {SAMPLE_TOKENS.map((t, i) => (
            <TokenRow key={i} tok={t} onClick={() => s.go('asset-detail', { selectedToken: t })} />
          ))}
        </div>
      </div>
      <BottomNav />
    </ExtPopup>
  );
}

// ============================================================
// 4. Asset detail
// ============================================================
function AssetDetailScreen() {
  const s = useSimple();
  const t = s.selectedToken || SAMPLE_TOKENS[0];
  return (
    <ExtPopup label="04 Asset detail">
      <SimpleHeader title={t.name} action={<button className="icbtn"><Icon name="more-horizontal" /></button>} />
      <div className="screen-body">
        <div className="balance-block">
          <div className="lbl">Your balance</div>
          <div className="val" style={{ fontSize: 32 }}>{t.amount} <span style={{ color: 'var(--ink-3)', fontSize: 18 }}>{t.unit}</span></div>
          <div className="delta">≈ ${t.fiat} · ${t.price}/{t.unit}{t.delta && <> · <span className={t.delta > 0 ? 'up' : 'down'}>{t.delta > 0 ? '+' : ''}{t.delta}%</span></>}</div>
        </div>
        {/* mini sparkline placeholder */}
        <div style={{ margin: '4px 16px 12px', height: 80, background: 'var(--bg-surface)', border: '1px solid var(--line)', borderRadius: 8, position: 'relative', overflow: 'hidden' }}>
          <svg viewBox="0 0 320 80" preserveAspectRatio="none" style={{ width: '100%', height: '100%' }}>
            <path d="M0 60 L 30 52 L 60 58 L 90 40 L 120 44 L 150 32 L 180 38 L 210 22 L 240 28 L 270 18 L 320 24" fill="none" stroke="var(--ink-1)" strokeWidth="1.5" />
            <path d="M0 60 L 30 52 L 60 58 L 90 40 L 120 44 L 150 32 L 180 38 L 210 22 L 240 28 L 270 18 L 320 24 L 320 80 L 0 80 Z" fill="var(--ink-1)" opacity="0.05" />
          </svg>
          <div style={{ position: 'absolute', top: 8, left: 12, display: 'flex', gap: 6 }}>
            {['1H', '1D', '1W', '1M', '1Y'].map((p, i) => (
              <span key={p} style={{ fontSize: 10, padding: '2px 6px', borderRadius: 3, color: i === 2 ? 'var(--ink-1)' : 'var(--ink-3)', background: i === 2 ? 'var(--bg-canvas)' : 'transparent', fontFamily: 'var(--font-mono)' }}>{p}</span>
            ))}
          </div>
        </div>
        <div style={{ padding: '0 16px', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, marginBottom: 16 }}>
          <button className="btn secondary" onClick={() => s.go('send')}><Icon name="arrow-up-right" size={14} /> Send</button>
          <button className="btn secondary" onClick={() => s.go('receive')}><Icon name="arrow-down-left" size={14} /> Receive</button>
          <button className="btn secondary" onClick={() => s.go('swap')}><Icon name="arrow-left-right" size={14} /> Swap</button>
        </div>
        <div className="sect-head"><div className="lbl">Recent</div></div>
        <div className="row-list">
          {SAMPLE_ACTIVITY.slice(0, 3).map((a, i) => <ActivityRow key={i} act={a} />)}
        </div>
      </div>
      <BottomNav />
    </ExtPopup>
  );
}

// ============================================================
// 5. Send
// ============================================================
function SendScreen() {
  const s = useSimple();
  const [step, setStep] = useState1('form'); // form → review
  const [amt, setAmt] = useState1('0.5');

  if (step === 'review') return (
    <ExtPopup label="05 Send · Review">
      <SimpleHeader title="Review transfer" onBack={() => setStep('form')} />
      <div className="screen-body" style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ padding: '20px 16px', background: 'var(--bg-surface)', border: '1px solid var(--line)', borderRadius: 8, textAlign: 'center' }}>
          <div style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 6 }}>You send</div>
          <div className="t-balance" style={{ fontSize: 32 }}>{amt} ETH</div>
          <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 6, fontFamily: 'var(--font-mono)' }}>≈ $1,521.09</div>
        </div>
        <div style={{ border: '1px solid var(--line)', borderRadius: 8, background: 'var(--bg-surface)' }}>
          {[
            ['From', s.account.name + ' · ' + shortAddr(s.account.address)],
            ['To', '0x9c4f3a1bd827e0fE…'],
            ['Network', 'Ethereum Mainnet'],
            ['Network fee', '$0.42 · 12 gwei'],
            ['Total', '$1,521.51'],
          ].map(([k, v], i, arr) => (
            <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 12px', borderBottom: i < arr.length - 1 ? '1px solid var(--line)' : 0 }}>
              <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{k}</span>
              <span style={{ fontSize: 12, color: 'var(--ink-1)', fontFamily: k.includes('To') || k.includes('From') ? 'var(--font-mono)' : 'var(--font-sans)', fontFeatureSettings: '"tnum" on' }}>{v}</span>
            </div>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        <button className="btn primary lg full"><Icon name="shield-check" size={14} /> Sign & send</button>
        <button className="btn ghost full" onClick={() => setStep('form')}>Cancel</button>
      </div>
    </ExtPopup>
  );

  return (
    <ExtPopup label="05 Send">
      <SimpleHeader title="Send" />
      <div className="screen-body" style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <span className="field-label">To</span>
          <div style={{ position: 'relative' }}>
            <input className="input mono" defaultValue="0x9c4f3a1bd827e0…" />
            <button className="icbtn" style={{ position: 'absolute', right: 6, top: 6 }}><Icon name="scan-line" /></button>
          </div>
        </div>
        <div>
          <span className="field-label">Amount</span>
          <div style={{ padding: 14, background: 'var(--bg-surface)', border: '1px solid var(--line-strong)', borderRadius: 6 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <input className="input amount" value={amt} onChange={e => setAmt(e.target.value)} />
              <select className="input" style={{ width: 90, height: 32 }}>
                <option>ETH</option><option>USDC</option><option>wBTC</option>
              </select>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 11, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)' }}>
              <span>≈ $1,521.09</span>
              <span>Available: 0.4218 · <button style={{ background: 'transparent', border: 0, color: 'var(--ink-1)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 'inherit', padding: 0 }}>Max</button></span>
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 12px', background: 'var(--bg-sunken)', borderRadius: 6 }}>
          <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>Network fee · standard</span>
          <span style={{ fontSize: 12, color: 'var(--ink-1)', fontFamily: 'var(--font-mono)' }}>$0.42 · 12 gwei</span>
        </div>
        <div style={{ flex: 1 }} />
        <button className="btn primary lg full" onClick={() => setStep('review')}>Review</button>
      </div>
    </ExtPopup>
  );
}

Object.assign(window, { WelcomeScreen, UnlockScreen, HomeScreen, AssetDetailScreen, SendScreen });
