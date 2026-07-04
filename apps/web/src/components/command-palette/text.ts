import type { CommandAction } from '~/components/command-palette/types';

function normalize(value: string) {
  return value
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .toLowerCase();
}

function actionAccepts(item: CommandAction, query: string) {
  const term = normalize(query);

  if (!term) return true;

  return [item.title, item.label ?? '', item.hotkey ?? ''].some((value) =>
    normalize(String(value)).includes(term),
  );
}

export { actionAccepts, normalize };
