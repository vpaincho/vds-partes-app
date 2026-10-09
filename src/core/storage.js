// The UI depends on this adapter, not directly on a future database schema.
export function createLocalRepository(storage, key) {
  return {
    load() {
      const raw = storage.getItem(key);
      if (!raw) return null;
      return JSON.parse(raw);
    },
    save(state) {
      storage.setItem(key, JSON.stringify(state));
    },
    export(state) {
      return JSON.stringify({ format: 'vds-partes', version: 1, exportedAt: new Date().toISOString(), state }, null, 2);
    }
  };
}
