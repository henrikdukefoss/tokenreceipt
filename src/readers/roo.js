// Roo Code: <editor>/User/globalStorage/rooveterinaryinc.roo-cline/tasks/<id>/ui_messages.json
// Same task layout as Cline; the model comes from <model> in api_conversation_history.json.
// A custom storage path set in the extension settings is not detected.
import { globalStorageTasks, loadTaskDirs } from './vscode-tasks.js';

export const id = 'roo-code';
export const name = 'Roo Code';

export async function load({ sinceMs = 0, untilMs = Infinity, env = process.env, platform } = {}) {
  const res = loadTaskDirs(globalStorageTasks(env, platform, 'rooveterinaryinc.roo-cline'), { agent: id, flavor: 'roo', sinceMs, untilMs });
  if (!res.found) return { found: false };
  return { found: true, detail: `${res.tasks} task${res.tasks === 1 ? '' : 's'}`, events: res.events };
}
