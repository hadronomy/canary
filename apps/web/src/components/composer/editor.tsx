import type { Content, Editor } from '@tiptap/core';
import type { SuggestionKeyDownProps, SuggestionProps } from '@tiptap/suggestion';
import type { ComponentPropsWithoutRef, RefObject } from 'react';

import { Extension } from '@tiptap/core';
import CharacterCount from '@tiptap/extension-character-count';
import Placeholder from '@tiptap/extension-placeholder';
import { PluginKey } from '@tiptap/pm/state';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Suggestion, exitSuggestion } from '@tiptap/suggestion';
import { useCallback, useEffect, useMemo, useRef } from 'react';

import type { Cmd } from '~/components/composer/commands';

import { filter } from '~/components/composer/commands';
import { cn } from '~/lib/utils';

const key = new PluginKey('canary-slash');

export type FocusState = 'blurred' | 'focused';

export type ComposerSlashState =
  | { kind: 'closed' }
  | {
      active: number;
      command: (cmd: Cmd) => void;
      kind: 'open';
      query: string;
    };

type CompositionState = 'composing' | 'idle';

type Refs = {
  choose: RefObject<(cmd: Cmd) => void>;
  cmds: RefObject<Cmd[]>;
  query: RefObject<string>;
  set: (next: ComposerSlashState) => void;
  slash: RefObject<ComposerSlashState>;
};

type ComposerEditorProps = Omit<
  ComponentPropsWithoutRef<'div'>,
  'children' | 'onChange' | 'onSubmit'
> & {
  commands: Cmd[];
  disabled?: boolean;
  placeholder: string;
  slashState: ComposerSlashState;
  value: string;
  onCommand: (cmd: Cmd) => void;
  onEscape?: () => void;
  onFocusChange?: (next: FocusState) => void;
  onHistory: (dir: 'down' | 'up', text: string) => null | string;
  onSlashChange: (next: ComposerSlashState) => void;
  onSubmit: (text: string) => void;
  onValue: (text: string) => void;
};

function ComposerEditor({
  className,
  commands,
  disabled,
  onCommand,
  onEscape,
  onFocusChange,
  onHistory,
  onSlashChange,
  onSubmit,
  onValue,
  placeholder,
  slashState,
  value,
  ...props
}: ComposerEditorProps) {
  const slashRef = useRef<ComposerSlashState>(slashState);
  const cmds = useRef(commands);
  const choose = useRef(onCommand);
  const holder = useRef(placeholder);
  const query = useRef('');
  const composition = useRef<CompositionState>('idle');

  slashRef.current = slashState;
  cmds.current = commands;
  choose.current = onCommand;
  holder.current = placeholder;

  const set = useCallback(
    (next: ComposerSlashState) => {
      slashRef.current = next;
      onSlashChange(next);
    },
    [onSlashChange],
  );

  const ext = useMemo(() => slashExt({ choose, cmds, query, set, slash: slashRef }), [set]);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        blockquote: false,
        codeBlock: false,
        heading: false,
        horizontalRule: false,
      }),
      Placeholder.configure({
        emptyEditorClass: 'is-editor-empty',
        placeholder: () => holder.current,
      }),
      CharacterCount,
      ext,
    ],
    content: doc(value),
    editable: !disabled,
    editorProps: {
      attributes: {
        'aria-label': 'Message Canary',
        class: cn(
          'canary-composer-editor min-h-12 max-h-48 overflow-y-auto px-3 py-3 text-[15px] leading-7 outline-none',
          'selection:bg-aquatic/20',
        ),
        role: 'textbox',
      },
      handleDOMEvents: {
        compositionend: () => {
          composition.current = 'idle';
          return false;
        },
        compositionstart: () => {
          composition.current = 'composing';
          return false;
        },
      },
      handleKeyDown: (_view, event) => {
        if (slashRef.current.kind === 'open' && nav(event.key)) {
          return false;
        }

        if (event.key === 'Enter' && !event.shiftKey) {
          if (ime(event, composition.current)) {
            return false;
          }

          event.preventDefault();
          submit(editor, { disabled, onSubmit });
          return true;
        }

        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
          event.preventDefault();
          submit(editor, { disabled, onSubmit });
          return true;
        }

        if (event.key === 'Escape' && slashRef.current.kind === 'closed' && onEscape) {
          event.preventDefault();
          onEscape();
          return true;
        }

        if (
          (event.key === 'ArrowUp' || event.key === 'ArrowDown') &&
          slashRef.current.kind === 'closed'
        ) {
          const dir = event.key === 'ArrowUp' ? 'up' : 'down';

          if (!editor || !edge(editor, dir)) {
            return false;
          }

          const text = onHistory(dir, plain(editor));

          if (text === null) {
            return false;
          }

          event.preventDefault();
          editor.commands.setContent(doc(text), { emitUpdate: false });
          onValue(text);
          editor.commands.focus(dir === 'up' ? 'start' : 'end');
          return true;
        }

        return false;
      },
    },
    onBlur: () => onFocusChange?.('blurred'),
    onFocus: () => onFocusChange?.('focused'),
    onUpdate: ({ editor }) => {
      onValue(plain(editor));
    },
  });

  useEffect(() => {
    if (!editor) {
      return;
    }

    editor.setEditable(!disabled);
  }, [disabled, editor]);

  useEffect(() => {
    if (!editor) {
      return;
    }

    if (plain(editor) === value) {
      return;
    }

    editor.commands.setContent(doc(value), { emitUpdate: false });
  }, [editor, value]);

  return (
    <div className={cn('relative min-w-0', className)} {...props}>
      <EditorContent editor={editor} />
    </div>
  );
}

function slashExt(refs: Refs) {
  return Extension.create({
    name: 'canarySlash',
    addProseMirrorPlugins() {
      return [
        Suggestion<Cmd, Cmd>({
          editor: this.editor,
          pluginKey: key,
          char: '/',
          startOfLine: true,
          allowedPrefixes: null,
          items: ({ query }) => filter(refs.cmds.current, query),
          command: ({ editor, range, props }) => {
            editor.chain().focus().deleteRange(range).run();
            refs.choose.current(props);
            exitSuggestion(editor.view, key);
            refs.set({ kind: 'closed' });
          },
          render: () => ({
            onStart: (props) => update(refs, props),
            onUpdate: (props) => update(refs, props),
            onExit: () => {
              refs.query.current = '';
              refs.set({ kind: 'closed' });
            },
            onKeyDown: (props) => keydown(refs, props),
          }),
        }),
      ];
    },
  });
}

function update(refs: Refs, props: SuggestionProps<Cmd, Cmd>) {
  const previous = refs.slash.current;
  const previousActive =
    previous.kind === 'open' && refs.query.current === props.query ? previous.active : 0;

  const next: ComposerSlashState = {
    active: Math.min(previousActive, Math.max(0, props.items.length - 1)),
    command: props.command,
    kind: 'open',
    query: props.query,
  };

  refs.query.current = props.query;
  refs.set(next);
}

function keydown(refs: Refs, props: SuggestionKeyDownProps) {
  if (props.event.key === 'Escape') {
    exitSuggestion(props.view, key);
    refs.set({ kind: 'closed' });
    return true;
  }

  if (props.event.key === 'ArrowDown') {
    refs.set(step(refs.slash.current, refs.cmds.current, 1));
    return true;
  }

  if (props.event.key === 'ArrowUp') {
    refs.set(step(refs.slash.current, refs.cmds.current, -1));
    return true;
  }

  if (props.event.key === 'Enter' || props.event.key === 'Tab') {
    const slash = refs.slash.current;

    if (slash.kind === 'closed') {
      return true;
    }

    const items = filter(refs.cmds.current, slash.query);
    const cmd = items[slash.active];

    if (!cmd || cmd.disabled) {
      return true;
    }

    slash.command(cmd);
    return true;
  }

  return false;
}

function step(slash: ComposerSlashState, cmds: Cmd[], dir: number): ComposerSlashState {
  if (slash.kind === 'closed') {
    return slash;
  }

  const items = filter(cmds, slash.query);

  if (!items.length) {
    return slash;
  }

  return {
    ...slash,
    active: (slash.active + dir + items.length) % items.length,
  };
}

function doc(text: string): Content {
  return {
    type: 'doc',
    content: text.split(/\r?\n/).map((line) =>
      line
        ? {
            type: 'paragraph',
            content: [{ type: 'text', text: line }],
          }
        : { type: 'paragraph' },
    ),
  };
}

function plain(editor: Editor) {
  return editor.getText({ blockSeparator: '\n' });
}

function submit(
  editor: Editor | null,
  props: { disabled?: boolean; onSubmit: (text: string) => void },
) {
  if (!editor || props.disabled) {
    return;
  }

  const text = plain(editor).trim();

  if (!text) {
    return;
  }

  props.onSubmit(text);
}

function ime(event: KeyboardEvent, composing: CompositionState) {
  return composing === 'composing' || event.isComposing || event.keyCode === 229;
}

function nav(key: string) {
  return (
    key === 'ArrowDown' || key === 'ArrowUp' || key === 'Enter' || key === 'Escape' || key === 'Tab'
  );
}

function edge(editor: Editor | null, dir: 'down' | 'up') {
  if (!editor || !editor.state.selection.empty) {
    return false;
  }

  if (dir === 'up') {
    return editor.state.selection.from <= 1;
  }

  return editor.state.selection.to >= editor.state.doc.content.size - 1;
}

export { ComposerEditor };
export type { ComposerEditorProps };
