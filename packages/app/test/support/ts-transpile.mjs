// Test-only loader hooks: lets spawned Node processes (the CLI, the engine host)
// run the repo's TypeScript sources. Node's built-in type stripping rejects
// parameter properties, which this code base uses, so the files are transpiled
// with the repo's own `typescript` package. `./x.js` specifiers map to `./x.ts`.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (specifier.endsWith('.js') && context.parentURL?.endsWith('.ts')) {
      return nextResolve(`${specifier.slice(0, -3)}.ts`, context);
    }
    throw error;
  }
}

export async function load(url, context, nextLoad) {
  if (url.startsWith('file:') && url.endsWith('.ts') && !url.includes('/node_modules/')) {
    const file = fileURLToPath(url);
    const source = await readFile(file, 'utf8');
    const { outputText } = ts.transpileModule(source, {
      fileName: file,
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    });
    return { format: 'module', source: outputText, shortCircuit: true };
  }
  return nextLoad(url, context);
}
