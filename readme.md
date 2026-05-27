src/
  manifest.json

  popup/
    App.tsx
    routes/
      HomePage.tsx
      CreateWalletPage.tsx
      ImportWalletPage.tsx
      AccountPage.tsx
      RevealSeedPage.tsx
      RevealPrivateKeyPage.tsx
      SettingsPage.tsx
    components/
      AccountSwitcher.tsx
      BalanceCard.tsx
      NetworkSwitcher.tsx
      PasswordInput.tsx

  background/
    service-worker.ts

  core/
    vault/
      vault.service.ts
      vault.types.ts
      encryption.service.ts

    mnemonic/
      mnemonic.service.ts

    accounts/
      account.service.ts
      account.types.ts
      derivation.ts

    networks/
      network.service.ts
      chain-registry.ts

    balances/
      balance.service.ts

    rpc/
      rpc.client.ts

    storage/
      storage.repository.ts
      storage.types.ts

    security/
      password-policy.ts
      auto-lock.service.ts

  shared/
    errors.ts
    result.ts
    format.ts


    1. mnemonic.service.ts
2. derivation.ts
3. encryption.service.ts
4. vault.service.ts
5. storage.repository.ts
6. account.service.ts
7. rpc.client.ts
8. balance.service.ts
9. CreateWalletPage.tsx
10. HomePage.tsx


generate mnemonic
→ derive address
→ encrypt mnemonic
→ save vault
→ unlock vault
→ create account
→ get balance
→ show in popup


Следующий логичный этап — начать собирать Chrome extension UI:

src/popup/
  App.tsx
  routes/
    WelcomePage.tsx
    CreateWalletPage.tsx
    UnlockPage.tsx
    HomePage.tsx
    AccountPage.tsx
    RevealSeedPage.tsx
    RevealPrivateKeyPage.tsx
    SettingsPage.tsx

И техническую обвязку расширения:

public/
  manifest.json

src/background/
  service-worker.t

  Перед UI нужно будет поставить React/Vite и собрать extension-бандл.


  0x7f2445ab60484892e64d42f51b44623566446a7f94e06f4f9fc492304930c8ce

  