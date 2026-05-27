
import { mnemonicService } from "../src/core/mnemonic/mnemonic.service";
import { accountService } from "../src/core/accounts/account.service";

const mnemonic = mnemonicService.generateMnemonic({ wordCount: 12 });

console.log("DEMO MNEMONIC:");
console.log(mnemonic);
console.log("");

let state = accountService.createInitialAccountsState(mnemonic);

console.log("INITIAL STATE:");
console.log(state);
console.log("");

state = accountService.addAccountToState(state, mnemonic);
state = accountService.addAccountToState(state, mnemonic);

console.log("STATE AFTER ADDING ACCOUNTS:");
console.log(state);
console.log("");

const selectedAccount = accountService.getSelectedAccount(state);

console.log("SELECTED ACCOUNT:");
console.log(selectedAccount);
console.log("");

const firstAccountId = state.accounts[0].id;

state = accountService.selectAccount(state, firstAccountId);

console.log("AFTER SELECTING FIRST ACCOUNT:");
console.log(accountService.getSelectedAccount(state));
console.log("");

state = accountService.renameAccount(state, {
  accountId: firstAccountId,
  label: "Main Wallet",
});

console.log("AFTER RENAME:");
console.log(accountService.getSelectedAccount(state));