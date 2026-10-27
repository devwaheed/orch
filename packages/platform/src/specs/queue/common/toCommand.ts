import type { SpecDraft } from '@orchagents/contracts';
import { quoteCommandArg } from '../../../jobs/common/toCommand.js';

export function specDraftToCommand(draft: SpecDraft): string {
  const args = ['orch', 'specs', 'add', quoteCommandArg(draft.title)];
  if (draft.body) args.push('--body', quoteCommandArg(draft.body));
  if (draft.mode !== 'single') args.push('--mode', draft.mode);
  for (const agent of draft.agents) args.push('--agent', agent);
  for (const line of draft.done_when) {
    if (line.by === 'check') {
      if (line.check.kind === 'command') args.push('--check', quoteCommandArg(line.check.run));
      else if (line.check.kind === 'http') args.push('--web-check', quoteCommandArg(line.check.url));
    } else if (line.text !== 'The goal is met') args.push('--audit', quoteCommandArg(line.text));
  }
  for (const glob of draft.scope) args.push('--allow', quoteCommandArg(glob));
  if (draft.runNext) args.push('--next');
  return args.join(' ');
}
