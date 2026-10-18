import type { ActionNode } from '@tilewright/behaviors';
import type { EditorDoc } from './doc';

/** A one-click repair offered next to a problem in the Problems panel. */
export type ProblemFix = { label: string } & (
  | { kind: 'remove-wire'; id: string }
  | { kind: 'remove-entity'; id: string }
  | { kind: 'remove-action'; node: string; index: number }
  | { kind: 'remove-graph-link'; graph: string; index: number }
  | { kind: 'remove-graph-node'; graph: string; node: string }
);

/** Carry out a fix as one undo step. */
export function applyFix(doc: EditorDoc, fix: ProblemFix): void {
  switch (fix.kind) {
    case 'remove-wire':
      doc.removeWire(fix.id);
      break;
    case 'remove-entity':
      doc.removeEntities([fix.id], fix.label);
      break;
    case 'remove-action':
      doc.updateEntities([fix.node], fix.label, (x) => {
        (x.components.actionNode as ActionNode).actions.splice(fix.index, 1);
      });
      break;
    case 'remove-graph-link':
      doc.setGraphs(
        fix.label,
        doc.graphs.map((g) => (g.id === fix.graph ? { ...g, links: g.links.filter((_, i) => i !== fix.index) } : g)),
      );
      break;
    case 'remove-graph-node':
      doc.setGraphs(
        fix.label,
        doc.graphs.map((g) => (g.id === fix.graph ? { ...g, nodes: g.nodes.filter((n) => n.id !== fix.node), links: g.links.filter((l) => l.from.node !== fix.node && l.to.node !== fix.node) } : g)),
      );
      break;
  }
}
