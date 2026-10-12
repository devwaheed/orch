import { AgentId } from '@orchagents/contracts';
import { ExitCode } from '../../common/exitCodes.js';
import { formatAgentAccount, formatStatus, formatTable } from '../../common/format.js';
import type { CliServices } from '../client.js';

export async function accountsListCommand(
  services: CliServices,
  options: { json?: boolean | undefined },
  output: (msg: string) => void,
): Promise<number> {
  const result = await services.accounts.list();
  if (!result.ok) {
    output(
      `Error: ${result.error.message}${result.error.fix ? `\nFix: ${result.error.fix}` : ''}`,
    );
    return ExitCode.ProblemFound;
  }

  if (options.json) {
    output(JSON.stringify(result.value, null, 2));
    return ExitCode.Success;
  }

  if (result.value.length === 0) {
    output('No accounts found.');
    return ExitCode.Success;
  }

  const headers = ['ACCOUNT', 'EMAIL', 'STATUS', 'PRIMARY', 'USE'];
  const rows = result.value.map((account) => {
    const accountStr = formatAgentAccount(
      account.agent,
      account.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    );
    return [
      accountStr,
      account.emailMasked ?? '—',
      formatStatus(account.state),
      account.primary ? 'yes' : 'no',
      account.use ? 'yes' : 'no',
    ];
  });

  output(formatTable(headers, rows));
  return ExitCode.Success;
}

export async function accountsAddCommand(
  services: CliServices,
  agentStr: string,
  name: string,
  options: { json?: boolean | undefined },
  output: (msg: string) => void,
): Promise<number> {
  const agentParsed = AgentId.safeParse(agentStr);
  if (!agentParsed.success) {
    output(
      `Invalid agent '${agentStr}'. Supported agents: claude, codex, gemini, opencode, agy.`,
    );
    return ExitCode.InvalidUsage;
  }

  const trimmedName = name.trim();
  if (trimmedName.length === 0 || trimmedName.length > 40) {
    output(`Invalid account name '${name}'. Name must be 1 to 40 characters.`);
    return ExitCode.InvalidUsage;
  }

  const addResult = await services.accounts.add({
    agent: agentParsed.data,
    name: trimmedName,
  });

  if (!addResult.ok) {
    output(
      `Error: ${addResult.error.message}${addResult.error.fix ? `\nFix: ${addResult.error.fix}` : ''}`,
    );
    return ExitCode.ProblemFound;
  }

  const account = addResult.value;
  const signInResult = await services.accounts.signIn(account.id);
  if (!signInResult.ok) {
    output(
      `Error: ${signInResult.error.message}${signInResult.error.fix ? `\nFix: ${signInResult.error.fix}` : ''}`,
    );
    return ExitCode.ProblemFound;
  }

  if (options.json) {
    output(JSON.stringify(signInResult.value, null, 2));
    return ExitCode.Success;
  }

  const emailText = signInResult.value.emailMasked ?? account.emailMasked;
  const signedInLine = emailText ? `Signed in as ${emailText}` : 'Signed in';
  const lines = [
    `✓ ${signedInLine}`,
    '✓ Kept separate: in its own private folder.',
    '✓ Ready: usage tracking is on and orch can route work to it.',
  ];

  output(lines.join('\n'));
  return ExitCode.Success;
}
