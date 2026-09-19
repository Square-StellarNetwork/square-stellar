import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ProviderState, ProviderStore } from "./provider.js";

/**
 * The provider's state as a JSON file, written whole on every save through a
 * rename, so a crash mid-write leaves the previous state rather than half a
 * file. A missing file is an empty state.
 */
export function fileStore(path: string): ProviderStore {
  return {
    async load() {
      try {
        const parsed = JSON.parse(await readFile(path, "utf8")) as ProviderState;
        if (typeof parsed !== "object" || parsed === null || typeof parsed.jobs !== "object") throw new Error(`${path} is not a provider state file`);
        return parsed;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw error;
      }
    },
    async save(state) {
      await mkdir(dirname(path), { recursive: true });
      const temporary = `${path}.${process.pid}.tmp`;
      await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`);
      await rename(temporary, path);
    },
  };
}
