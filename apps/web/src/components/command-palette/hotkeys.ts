import type { RegisterableHotkey, UseHotkeyDefinition } from '@tanstack/react-hotkeys';

import { useHotkeys } from '@tanstack/react-hotkeys';

import type { CommandAction, CommandItem } from '~/components/command-palette/types';

type CommandHotkeysProps = {
  actions: () => void;
  item: CommandItem | null;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  runAction: (item: CommandItem, action: CommandAction) => void;
  submit?: CommandAction;
  submitRun: () => void;
  toggle?: RegisterableHotkey;
};

function useCommandHotkeys(props: CommandHotkeysProps) {
  const defs: UseHotkeyDefinition[] = [
    {
      hotkey: props.toggle ?? 'Mod+K',
      callback: (event) => {
        event.preventDefault();

        if (props.open) {
          props.actions();
          return;
        }

        props.onOpenChange(true);
      },
      options: {
        meta: {
          name: 'Command palette',
          description: 'Open command search, or reveal actions for the selected command.',
        },
      },
    },
  ];

  if (props.open && props.submit?.hotkey) {
    defs.push({
      hotkey: props.submit.hotkey,
      callback: (event) => {
        event.preventDefault();
        props.submitRun();
      },
      options: {
        enabled: true,
        meta: {
          name: props.submit.title,
          description: 'Run the current command page submit action.',
        },
      },
    });
  }

  const item = props.item;

  if (props.open && item) {
    item.actions
      .filter((item) => item.hotkey && item.hotkey !== 'Enter')
      .forEach((action) => {
        defs.push({
          hotkey: action.hotkey!,
          callback: (event) => {
            event.preventDefault();
            props.runAction(item, action);
          },
          options: {
            enabled: true,
            meta: {
              name: action.title,
              description: `Run action for ${item.title}.`,
            },
          },
        });
      });
  }

  useHotkeys(defs, {
    conflictBehavior: 'replace',
    ignoreInputs: false,
    preventDefault: true,
    requireReset: true,
    stopPropagation: true,
  });
}

export { useCommandHotkeys };
