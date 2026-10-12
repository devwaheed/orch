/**
 * Field errors from the accounts config file (config.invalid events and failed saves).
 * Lives in services so that apply.ts can write it without importing a contrib area;
 * the accounts screen reads it from here.
 */
import { create } from 'zustand';
import type { ConfigFieldError } from '@orchagents/contracts';

export interface ConfigErrorsState {
  readonly errors: readonly ConfigFieldError[];
  setErrors(errors: readonly ConfigFieldError[]): void;
}

export const useConfigErrorsStore = create<ConfigErrorsState>()((set) => ({
  errors: [],
  setErrors: (errors) => set({ errors: [...errors] }),
}));
