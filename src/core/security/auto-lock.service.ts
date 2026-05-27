// src/core/security/auto-lock.service.ts

export type AutoLockState = {
  isLocked: boolean;
  lastActivityAt: number | null;
  lockedAt: number | null;
  remainingMs: number | null;
};

export type AutoLockConfig = {
  autoLockMinutes: number;
};

const MS_IN_MINUTE = 60_000;

export class AutoLockService {
  private lastActivityAt: number | null = null;
  private lockedAt: number | null = null;

  markActivity(now: number = Date.now()): void {
    this.lastActivityAt = now;
  }

  unlock(now: number = Date.now()): void {
    this.lastActivityAt = now;
    this.lockedAt = null;
  }

  lock(now: number = Date.now()): void {
    this.lockedAt = now;
    this.lastActivityAt = null;
  }

  reset(): void {
    this.lastActivityAt = null;
    this.lockedAt = null;
  }

  shouldAutoLock(config: AutoLockConfig, now: number = Date.now()): boolean {
    this.assertValidAutoLockMinutes(config.autoLockMinutes);

    if (this.lockedAt !== null) {
      return false;
    }

    if (this.lastActivityAt === null) {
      return false;
    }

    const timeoutMs = config.autoLockMinutes * MS_IN_MINUTE;
    const inactiveMs = now - this.lastActivityAt;

    return inactiveMs >= timeoutMs;
  }

  getRemainingMs(
    config: AutoLockConfig,
    now: number = Date.now()
  ): number | null {
    this.assertValidAutoLockMinutes(config.autoLockMinutes);

    if (this.lockedAt !== null || this.lastActivityAt === null) {
      return null;
    }

    const timeoutMs = config.autoLockMinutes * MS_IN_MINUTE;
    const inactiveMs = now - this.lastActivityAt;
    const remainingMs = timeoutMs - inactiveMs;

    return Math.max(remainingMs, 0);
  }

  getState(config: AutoLockConfig, now: number = Date.now()): AutoLockState {
    return {
      isLocked: this.lockedAt !== null,
      lastActivityAt: this.lastActivityAt,
      lockedAt: this.lockedAt,
      remainingMs: this.getRemainingMs(config, now),
    };
  }

  private assertValidAutoLockMinutes(autoLockMinutes: number): void {
    if (!Number.isInteger(autoLockMinutes)) {
      throw new Error("Auto-lock minutes must be an integer.");
    }

    if (autoLockMinutes <= 0) {
      throw new Error("Auto-lock minutes must be greater than 0.");
    }
  }
}

export const autoLockService = new AutoLockService();