#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

function getArgValue(args, flag) {
  const idx = args.indexOf(flag);
  if (idx !== -1 && idx + 1 < args.length) {
    return args[idx + 1];
  }
  return null;
}

function getConfigDir() {
  return (
    process.env.FAKE_AGENT_CONFIG_DIR ||
    process.env.CLAUDE_CONFIG_DIR ||
    process.env.CODEX_HOME ||
    process.env.GEMINI_CLI_HOME ||
    process.env.OPENCODE_CONFIG_DIR ||
    process.env.XDG_DATA_HOME ||
    process.env.HOME ||
    process.env.USERPROFILE ||
    process.cwd()
  );
}

function loadScenario(turnIndex = 0) {
  const configDir = getConfigDir();
  let config = null;

  const scriptPath = path.join(configDir, 'fake-agent.json');
  if (fs.existsSync(scriptPath)) {
    try {
      const raw = fs.readFileSync(scriptPath, 'utf8');
      config = JSON.parse(raw);
    } catch {
      // ignore JSON parse error, fallback
    }
  }

  if (process.env.FAKE_AGENT_SCENARIO) {
    try {
      config = JSON.parse(process.env.FAKE_AGENT_SCENARIO);
    } catch {
      config = { scenario: process.env.FAKE_AGENT_SCENARIO };
    }
  }

  const cliScenario = getArgValue(process.argv, '--scenario');
  if (cliScenario) {
    config = { ...(config || {}), scenario: cliScenario };
  }

  if (typeof config === 'string') {
    config = { scenario: config };
  }

  if (!config) {
    config = { scenario: 'succeed' };
  }

  if (Array.isArray(config.turns) && config.turns.length > 0) {
    const turnConfig = config.turns[turnIndex] || config.turns[config.turns.length - 1];
    return typeof turnConfig === 'string' ? { scenario: turnConfig } : turnConfig;
  }

  return config;
}

function applyFiles(scenario) {
  if (Array.isArray(scenario.files)) {
    for (const f of scenario.files) {
      if (f && typeof f.path === 'string') {
        const fullPath = path.resolve(process.cwd(), f.path);
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, f.content ?? '', 'utf8');
      }
    }
  }
}

function getAccountEnvString() {
  const keys = [
    'CLAUDE_CONFIG_DIR',
    'CODEX_HOME',
    'GEMINI_CLI_HOME',
    'OPENCODE_CONFIG_DIR',
    'XDG_DATA_HOME',
    'HOME',
    'USERPROFILE',
  ];
  const found = keys
    .filter((k) => process.env[k] !== undefined && process.env[k] !== '')
    .map((k) => `${k}=${process.env[k]}`);
  return found.length > 0 ? found.join(', ') : 'none';
}

async function main() {
  const args = process.argv.slice(2);

  // 1. Version check
  if (args.includes('--version') || args.includes('-v')) {
    console.log('1.0.0');
    process.exit(0);
  }

  // 2. WhoAmI check
  if (args.includes('whoami')) {
    const configDir = getConfigDir();
    const accountFile = path.join(configDir, 'account.json');
    if (fs.existsSync(accountFile)) {
      try {
        const data = JSON.parse(fs.readFileSync(accountFile, 'utf8'));
        if (data && data.emailMasked && data.signedIn !== false) {
          const planStr = data.plan ? ` (${data.plan})` : '';
          console.log(`Logged in as ${data.emailMasked}${planStr}`);
          process.exit(0);
        }
      } catch {
        // ignore
      }
    }
    console.log('Not logged in');
    process.exit(1);
  }

  // 3. Login command
  if (args.includes('login')) {
    const configDir = getConfigDir();
    fs.mkdirSync(configDir, { recursive: true });
    const accountFile = path.join(configDir, 'account.json');
    const emailMasked = process.env.FAKE_AGENT_EMAIL_MASKED || 'f•••@example.com';
    const plan = process.env.FAKE_AGENT_PLAN || 'pro';
    fs.writeFileSync(accountFile, JSON.stringify({ emailMasked, plan, signedIn: true }, null, 2), 'utf8');
    console.log(`Logged in as ${emailMasked} (${plan})`);
    process.exit(0);
  }

  // 4. Logout command
  if (args.includes('logout')) {
    const configDir = getConfigDir();
    const accountFile = path.join(configDir, 'account.json');
    if (fs.existsSync(accountFile)) {
      fs.unlinkSync(accountFile);
    }
    console.log('Logged out');
    process.exit(0);
  }

  // 5. Codex one-shot form (`exec --json ...`)
  if (args.includes('exec')) {
    let threadId = 'fake-codex-thread-1';
    const resumeIdx = args.indexOf('resume');
    if (resumeIdx !== -1 && args[resumeIdx + 1]) {
      threadId = args[resumeIdx + 1];
    }

    const configDir = getConfigDir();
    const stateFile = path.join(configDir, '.fake-agent-codex-state.json');
    let turnIndex = 0;
    if (fs.existsSync(stateFile)) {
      try {
        const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
        turnIndex = state.turnIndex || 0;
      } catch {
        // ignore
      }
    }
    try {
      fs.writeFileSync(stateFile, JSON.stringify({ turnIndex: turnIndex + 1 }), 'utf8');
    } catch {
      // ignore state write failure if dir unwritable
    }

    process.stdout.write(JSON.stringify({ type: 'thread.started', thread_id: threadId }) + '\n');

    const currentScenario = loadScenario(turnIndex);
    const scenarioName = currentScenario.scenario || 'succeed';

    if (scenarioName === 'hang') {
      await new Promise(() => {});
    }

    if (scenarioName === 'crash') {
      process.stderr.write(currentScenario.errorMessage || 'Fake agent crashed\n');
      process.exit(currentScenario.exitCode || 1);
    }

    if (scenarioName === 'limit') {
      const resetsAt = currentScenario.resetsAt || new Date(Date.now() + 5 * 3600 * 1000).toISOString();
      const window = currentScenario.window || '5h';
      const usedPct = currentScenario.usedPct !== undefined ? currentScenario.usedPct : 100;
      const limitMessage = `Rate limit reached. Resets at ${resetsAt} (window: ${window}, used: ${usedPct}%)`;

      process.stdout.write(limitMessage + '\n');
      process.stdout.write(JSON.stringify({ type: 'turn.failed', error: { message: limitMessage } }) + '\n');
      process.exit(0);
    }

    let resultText = '';
    if (scenarioName === 'echo_account') {
      resultText = `Account env: ${getAccountEnvString()}`;
    } else if (scenarioName === 'edit_files') {
      applyFiles(currentScenario);
      resultText = currentScenario.response || `Edited ${(currentScenario.files || []).length} file(s)`;
    } else if (scenarioName === 'fail_tests') {
      if (Array.isArray(currentScenario.files) && currentScenario.files.length > 0) {
        applyFiles(currentScenario);
      } else {
        applyFiles({ files: [{ path: 'test-failure.txt', content: 'FAIL' }] });
      }
      resultText = currentScenario.response || 'Changes applied (test failure scenario)';
    } else {
      applyFiles(currentScenario);
      resultText = currentScenario.response || 'Task completed successfully.';
    }

    process.stdout.write(
      JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: resultText } }) + '\n',
    );
    process.stdout.write(
      JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 30, output_tokens: 40 } }) + '\n',
    );
    process.exit(0);
  }

  // 6. Claude stream-json protocol (Claw PersistentSession)
  const isStreamJson =
    args.includes('--input-format') ||
    args.includes('--output-format') ||
    args.includes('stream-json') ||
    args.includes('-p');

  if (isStreamJson) {
    const sessionId = getArgValue(args, '--session-id') || `fake-session-${Date.now()}`;
    const initEvent = {
      type: 'system',
      subtype: 'init',
      session_id: sessionId,
    };
    process.stdout.write(JSON.stringify(initEvent) + '\n');

    let turnIndex = 0;
    const initialScenario = loadScenario(0);
    if (initialScenario.scenario === 'crash' && initialScenario.crashOnStartup) {
      process.stderr.write(initialScenario.errorMessage || 'Fake agent crashed on startup\n');
      process.exit(initialScenario.exitCode || 1);
    }

    const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

    rl.on('line', async (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let parsed;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        return;
      }
      if (parsed.type !== 'user') return;
      const uuid = parsed.uuid;
      const currentScenario = loadScenario(turnIndex++);
      if (currentScenario.recordInputs) {
        fs.appendFileSync(path.join(getConfigDir(), 'inputs.jsonl'), JSON.stringify(parsed.message ?? null) + '\n');
      }
      const name = currentScenario.scenario || 'succeed';

      if (name === 'hang') {
        await new Promise(() => {});
      }

      if (name === 'crash') {
        process.stderr.write(currentScenario.errorMessage || 'Fake agent crashed on turn\n');
        process.exit(currentScenario.exitCode || 1);
      }

      if (name === 'limit') {
        const resetsAt = currentScenario.resetsAt || new Date(Date.now() + 5 * 3600 * 1000).toISOString();
        const window = currentScenario.window || '5h';
        const usedPct = currentScenario.usedPct !== undefined ? currentScenario.usedPct : 100;
        const limitMessage = `Rate limit reached. Resets at ${resetsAt} (window: ${window}, used: ${usedPct}%)`;

        process.stdout.write(limitMessage + '\n');

        const resultEvent = {
          type: 'result',
          user_message_uuids: uuid ? [uuid] : [],
          result: limitMessage,
          stop_reason: 'rate_limit',
          is_error: true,
          usage: { input_tokens: 10, output_tokens: 5 },
        };
        process.stdout.write(JSON.stringify(resultEvent) + '\n');
        return;
      }

      if (name === 'agent_error') {
        const message = currentScenario.errorMessage || 'Not logged in · Please run /login';
        process.stdout.write(JSON.stringify({
          type: 'result',
          user_message_uuids: uuid ? [uuid] : [],
          result: message,
          is_error: true,
          error: { message },
          usage: { input_tokens: 10, output_tokens: 0 },
        }) + '\n');
        return;
      }

      let resultText = '';
      if (name === 'echo_account') {
        resultText = `Account env: ${getAccountEnvString()}`;
      } else if (name === 'edit_files') {
        applyFiles(currentScenario);
        resultText = currentScenario.response || `Edited ${(currentScenario.files || []).length} file(s)`;
      } else if (name === 'fail_tests') {
        if (Array.isArray(currentScenario.files) && currentScenario.files.length > 0) {
          applyFiles(currentScenario);
        } else {
          applyFiles({ files: [{ path: 'test-failure.txt', content: 'FAIL' }] });
        }
        resultText = currentScenario.response || 'Changes applied (test failure scenario)';
      } else {
        applyFiles(currentScenario);
        resultText = currentScenario.response || 'Task completed successfully.';
      }

      const assistantEvent = {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: name === 'stream_then_delay'
            ? [
                { type: 'text', text: resultText },
                { type: 'tool_use', id: 'fake-write-1', name: 'Write', input: { file_path: 'src/streamed.js', content: 'export const streamed = true;\n' } },
              ]
            : [{ type: 'text', text: resultText }],
        },
      };
      if (name === 'stream_then_delay') {
        process.stdout.write(JSON.stringify({
          type: 'stream_event',
          event: { type: 'content_block_delta', delta: { type: 'text_delta', text: resultText } },
        }) + '\n');
      }
      process.stdout.write(JSON.stringify(assistantEvent) + '\n');

      // Keep the turn open after its first streamed assistant event so the
      // platform integration test can observe output before the run finishes.
      if (name === 'stream_then_delay') {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }

      const resultEvent = {
        type: 'result',
        user_message_uuids: uuid ? [uuid] : [],
        result: resultText,
        total_cost_usd: 0.001,
        usage: { input_tokens: 25, output_tokens: 35 },
      };
      process.stdout.write(JSON.stringify(resultEvent) + '\n');
    });

    rl.on('close', () => {
      process.exit(0);
    });

    return;
  }

  // 7. Plain CLI fallback (one-shot, non-stream)
  const fallbackScenario = loadScenario(0);
  const name = fallbackScenario.scenario || 'succeed';

  if (name === 'hang') {
    await new Promise(() => {});
  }

  if (name === 'crash') {
    process.stderr.write(fallbackScenario.errorMessage || 'Fake agent crashed\n');
    process.exit(fallbackScenario.exitCode || 1);
  }

  if (name === 'limit') {
    const resetsAt = fallbackScenario.resetsAt || new Date(Date.now() + 5 * 3600 * 1000).toISOString();
    const window = fallbackScenario.window || '5h';
    const usedPct = fallbackScenario.usedPct !== undefined ? fallbackScenario.usedPct : 100;
    const limitMessage = `Rate limit reached. Resets at ${resetsAt} (window: ${window}, used: ${usedPct}%)`;
    console.log(limitMessage);
    process.exit(0);
  }

  let resultText = '';
  if (name === 'echo_account') {
    resultText = `Account env: ${getAccountEnvString()}`;
  } else if (name === 'edit_files' || name === 'succeed') {
    applyFiles(fallbackScenario);
    resultText = fallbackScenario.response || 'Task completed successfully.';
  } else if (name === 'fail_tests') {
    if (Array.isArray(fallbackScenario.files) && fallbackScenario.files.length > 0) {
      applyFiles(fallbackScenario);
    } else {
      applyFiles({ files: [{ path: 'test-failure.txt', content: 'FAIL' }] });
    }
    resultText = fallbackScenario.response || 'Changes applied (test failure scenario)';
  }
  console.log(resultText);
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`Fatal error in fake-agent: ${err.message}\n`);
  process.exit(1);
});
