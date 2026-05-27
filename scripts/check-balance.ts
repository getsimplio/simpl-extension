// scripts/check-balance.ts

import { mnemonicService } from "../src/core/mnemonic/mnemonic.service";
import { accountService } from "../src/core/accounts/account.service";
import { balanceService } from "../src/core/balances/balance.service";
import {
  ETHEREUM_MAINNET_CHAIN_ID,
  SEPOLIA_CHAIN_ID,
  BASE_CHAIN_ID,
} from "../src/core/networks/chain-registry";

const mnemonic = mnemonicService.generateMnemonic({ wordCount: 12 });
const accountsState = accountService.createInitialAccountsState(mnemonic);
const account = accountsState.accounts[0];

console.log("DEMO MNEMONIC:");
console.log(mnemonic);
console.log("");

console.log("ACCOUNT:");
console.log({
  label: account.label,
  address: account.address,
  derivationPath: account.derivationPath,
});
console.log("");

const chainIds = [
  ETHEREUM_MAINNET_CHAIN_ID,
  SEPOLIA_CHAIN_ID,
  BASE_CHAIN_ID,
];

for (const chainId of chainIds) {
  console.log(`BALANCE CHECK — chainId ${chainId}`);

  try {
    const balance = await balanceService.getNativeBalance(
      account.address,
      chainId
    );

    console.log({
      chainName: balance.chainName,
      symbol: balance.symbol,
      balanceWei: balance.balanceWei,
      formatted: `${balance.formatted} ${balance.symbol}`,
      updatedAt: balance.updatedAt,
    });
  } catch (error) {
    console.log({
      failed: true,
      message: error instanceof Error ? error.message : String(error),
    });
  }

  console.log("");
}