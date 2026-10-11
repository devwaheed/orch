/**
 * The terminal dock's tab state, held in one zustand store. Only the controller
 * writes it (through the pure functions in terminalTabs.ts); the dock reads it.
 */
import { create } from 'zustand';
import { EMPTY_TERMINAL_TABS, type TerminalTabsState } from './terminalTabs.js';

export const useTerminalStore = create<TerminalTabsState>()(() => EMPTY_TERMINAL_TABS);
