import { resolve } from 'node:path';
import Mocha from 'mocha';

export async function run(): Promise<void> {
  const mocha = new Mocha({ ui: 'tdd', color: true, timeout: 15_000 });
  mocha.addFile(resolve(__dirname, 'smoke.js'));
  await new Promise<void>((resolveRun, reject) => {
    mocha.run((failures) => failures === 0
      ? resolveRun()
      : reject(new Error(`${failures} VS Code integration test(s) failed`)));
  });
}
