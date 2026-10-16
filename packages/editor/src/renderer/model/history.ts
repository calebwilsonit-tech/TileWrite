/** One undoable step. `redo` must be safe to call again after `undo`. */
export interface Command {
  label: string;
  redo(): void;
  undo(): void;
}

/**
 * Global undo/redo. Every change the user makes goes through here as one Command, so Ctrl+Z always
 * means "undo the last thing I did", whatever panel it came from.
 */
export class History {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  /** Commands currently being grouped (e.g. "paste = add 5 entities"). */
  private group: Command[] | null = null;
  private groupLabel = '';

  constructor(private readonly limit = 500) {}

  /** Add an already-applied command to the history. */
  push(cmd: Command): void {
    if (this.group) {
      this.group.push(cmd);
      return;
    }
    this.undoStack.push(cmd);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
  }

  /** Apply a command and add it. */
  run(cmd: Command): void {
    cmd.redo();
    this.push(cmd);
  }

  /** Everything pushed inside `fn` becomes a single undo step. */
  batch(label: string, fn: () => void): void {
    if (this.group) {
      fn();
      return;
    }
    this.group = [];
    this.groupLabel = label;
    try {
      fn();
    } finally {
      const cmds = this.group;
      this.group = null;
      if (cmds.length > 0) {
        this.push({
          label: this.groupLabel,
          redo: () => cmds.forEach((c) => c.redo()),
          undo: () => [...cmds].reverse().forEach((c) => c.undo()),
        });
      }
    }
  }

  undo(): string | undefined {
    const cmd = this.undoStack.pop();
    if (!cmd) return undefined;
    cmd.undo();
    this.redoStack.push(cmd);
    return cmd.label;
  }

  redo(): string | undefined {
    const cmd = this.redoStack.pop();
    if (!cmd) return undefined;
    cmd.redo();
    this.undoStack.push(cmd);
    return cmd.label;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  get undoLabel(): string | undefined {
    return this.undoStack.at(-1)?.label;
  }

  get redoLabel(): string | undefined {
    return this.redoStack.at(-1)?.label;
  }

  /** Labels, newest first (for a history panel). */
  get labels(): string[] {
    return [...this.undoStack].reverse().map((c) => c.label);
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }
}
