import {
  generateMnemonic as generateBip39Mnemonic,
  validateMnemonic as validateBip39Mnemonic,
} from "@scure/bip39";

import { wordlist } from "@scure/bip39/wordlists/english.js";

export type MnemonicWordCount = 12 | 24;

export type GenerateMnemonicOptions = {
  wordCount?: MnemonicWordCount;
};

export type MnemonicValidationErrorCode =
  | "EMPTY_MNEMONIC"
  | "INVALID_WORD_COUNT"
  | "INVALID_CHECKSUM_OR_WORDS";

export type MnemonicValidationResult =
  | {
      valid: true;
      mnemonic: string;
      words: string[];
      wordCount: number;
    }
  | {
      valid: false;
      mnemonic: string;
      words: string[];
      wordCount: number;
      errorCode: MnemonicValidationErrorCode;
      message: string;
    };

const STRENGTH_BY_WORD_COUNT: Record<MnemonicWordCount, number> = {
  12: 128,
  24: 256,
};

const SUPPORTED_WORD_COUNTS: MnemonicWordCount[] = [12, 24];

export class MnemonicService {
  generateMnemonic(options: GenerateMnemonicOptions = {}): string {
    const wordCount = options.wordCount ?? 12;
    const strength = STRENGTH_BY_WORD_COUNT[wordCount];

    return generateBip39Mnemonic(wordlist, strength);
  }

  normalizeMnemonic(input: string): string {
    return input.trim().toLowerCase().replace(/\s+/g, " ");
  }

  getWords(input: string): string[] {
    const normalized = this.normalizeMnemonic(input);

    if (!normalized) {
      return [];
    }

    return normalized.split(" ");
  }

  getWordCount(input: string): number {
    return this.getWords(input).length;
  }

  validateMnemonic(input: string): MnemonicValidationResult {
    const mnemonic = this.normalizeMnemonic(input);
    const words = this.getWords(mnemonic);
    const wordCount = words.length;

    if (!mnemonic) {
      return {
        valid: false,
        mnemonic,
        words,
        wordCount,
        errorCode: "EMPTY_MNEMONIC",
        message: "Seed phrase is empty.",
      };
    }

    if (!SUPPORTED_WORD_COUNTS.includes(wordCount as MnemonicWordCount)) {
      return {
        valid: false,
        mnemonic,
        words,
        wordCount,
        errorCode: "INVALID_WORD_COUNT",
        message: "Seed phrase must contain 12 or 24 words.",
      };
    }

    const isValid = validateBip39Mnemonic(mnemonic, wordlist);

    if (!isValid) {
      return {
        valid: false,
        mnemonic,
        words,
        wordCount,
        errorCode: "INVALID_CHECKSUM_OR_WORDS",
        message: "Seed phrase contains invalid words or has an invalid checksum.",
      };
    }

    return {
      valid: true,
      mnemonic,
      words,
      wordCount,
    };
  }

  assertValidMnemonic(input: string): string {
    const result = this.validateMnemonic(input);

    if (!result.valid) {
      throw new Error(result.message);
    }

    return result.mnemonic;
  }

  isValidMnemonic(input: string): boolean {
    return this.validateMnemonic(input).valid;
  }
}

export const mnemonicService = new MnemonicService();