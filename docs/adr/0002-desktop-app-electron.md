# ADR 0002: Desktop app with Electron, CLI included

- **Status:** Accepted
- **Date:** 2026-10-10

## Context

Users want a normal app: installer, icon, notifications, start at login, updates, on macOS, Windows and Linux. orch depends on Node (Claw, node-pty, agent tooling).

## Decision

Ship v1.0 as an Electron desktop app with electron-builder installers, electron-updater, Apple notarisation and Windows code signing. The `orch` command ships inside the app and on npm. A headless mode (`orch serve`) runs the same hosts as Node processes for machines without a desktop.

## Consequences

Node-based dependencies run unchanged. Signing certificates and their yearly fees are required, set up in phase 4. Tauri was rejected: it would need a separate Node process anyway.
