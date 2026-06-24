const max = 100;

type State = {
  draft: null | string;
  idx: number;
  rows: string[];
};

export function history() {
  const state: State = {
    draft: null,
    idx: -1,
    rows: [],
  };

  return {
    push(text: string) {
      const body = text.trim();

      if (!body || state.rows[0] === body) {
        state.idx = -1;
        state.draft = null;
        return;
      }

      state.rows = [body, ...state.rows.filter((row) => row !== body)].slice(0, max);
      state.idx = -1;
      state.draft = null;
    },
    reset() {
      state.idx = -1;
      state.draft = null;
    },
    step(dir: 'down' | 'up', draft: string) {
      if (!state.rows.length) {
        return null;
      }

      if (dir === 'up') {
        const idx = state.idx < 0 ? 0 : Math.min(state.idx + 1, state.rows.length - 1);
        state.draft = state.idx < 0 ? draft : state.draft;
        state.idx = idx;
        return state.rows[idx] ?? null;
      }

      if (state.idx <= 0) {
        const text = state.draft ?? '';
        state.idx = -1;
        state.draft = null;
        return text;
      }

      state.idx -= 1;
      return state.rows[state.idx] ?? null;
    },
  };
}
