'use strict';

/** localStorage persistence (fails soft in private windows) + JSON file import/export. */
const AppStorage = {
  KEYS: { world: 'neurodrive.world', brain: 'neurodrive.brain', settings: 'neurodrive.settings' },

  load(key) {
    try {
      const raw = localStorage.getItem(this.KEYS[key]);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },

  save(key, value) {
    try {
      if (value === null) localStorage.removeItem(this.KEYS[key]);
      else localStorage.setItem(this.KEYS[key], JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  },

  download(filename, data) {
    const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  },

  /** Opens the file picker and resolves with parsed JSON. */
  pick(input) {
    return new Promise((resolve, reject) => {
      input.value = '';
      input.onchange = () => {
        const file = input.files[0];
        if (!file) return;
        file.text().then((t) => resolve(JSON.parse(t))).catch(() => reject(new Error('Could not read that file as JSON')));
      };
      input.click();
    });
  },
};
