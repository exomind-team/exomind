import { WebStorageAdapter } from '@/lib/adapters/web-storage';
import type { IntentProgram, IntentProgramStorage } from '@/lib/types/intent-program';

const INTENT_PROGRAM_STORAGE_KEY = 'intent_programs';

function clonePrograms(programs: IntentProgram[]): IntentProgram[] {
  return structuredClone(programs);
}

export class IntentProgramWebStorageAdapter implements IntentProgramStorage {
  private readonly storage = new WebStorageAdapter();

  async read(): Promise<IntentProgram[] | null> {
    const programs = await this.storage.read<IntentProgram[]>(INTENT_PROGRAM_STORAGE_KEY);
    return Array.isArray(programs) ? clonePrograms(programs) : null;
  }

  async write(programs: IntentProgram[]): Promise<void> {
    await this.storage.write(INTENT_PROGRAM_STORAGE_KEY, clonePrograms(programs));
  }
}
