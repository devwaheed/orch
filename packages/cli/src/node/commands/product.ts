import type { FactoryPipeline, ISpecsService } from '@orchagents/contracts';
import type { CliServices } from '../client.js';
import { ExitCode } from '../../common/exitCodes.js';
import { formatTable } from '../../common/format.js';

function specs(services: CliServices): ISpecsService {
  return services.client.getService<ISpecsService>('specs');
}

function formatPipeline(pipeline: FactoryPipeline): string {
  return formatTable(['STAGE', 'GROUP', 'STATUS'], pipeline.stages.map((stage) => [stage.title, stage.group, stage.state]));
}

export async function productStatusCommand(
  services: CliServices,
  repoPath: string,
  json: boolean,
  output: (message: string) => void,
): Promise<number> {
  const result = await specs(services).factoryPipeline(repoPath);
  if (!result.ok) {
    output(`Error: ${result.error.message}${result.error.fix ? `\nFix: ${result.error.fix}` : ''}`);
    return ExitCode.ProblemFound;
  }
  if (!result.value) {
    output("This project hasn't been set up as a product yet.");
    return ExitCode.Success;
  }
  if (json) output(JSON.stringify(result.value, null, 2));
  else output(formatPipeline(result.value));
  return ExitCode.Success;
}

export async function productGateCommand(
  services: CliServices,
  repoPath: string,
  gateId: string,
  words: string,
  output: (message: string) => void,
): Promise<number> {
  const result = await specs(services).answerFactoryGate(repoPath, gateId, words);
  if (!result.ok) {
    output(`Error: ${result.error.message}${result.error.fix ? `\nFix: ${result.error.fix}` : ''}`);
    return ExitCode.ProblemFound;
  }
  output(formatPipeline(result.value));
  return ExitCode.Success;
}
