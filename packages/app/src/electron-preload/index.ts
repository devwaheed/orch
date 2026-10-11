/**
 * Preload script (SEC-02: sandboxed, context isolated). It exposes the single
 * `window.orch` object and nothing else from Electron or Node.
 */
import { contextBridge, ipcRenderer } from 'electron';
import { createOrchApi, type PageWindow } from './api.js';

const page = globalThis as unknown as PageWindow;

contextBridge.exposeInMainWorld('orch', createOrchApi(ipcRenderer, process.platform, page));
