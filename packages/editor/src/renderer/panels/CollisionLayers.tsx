import { layerList } from '@tilewright/behaviors';
import { CheckField, SelectField } from './fields';

/**
 * Which layer a collider belongs to and which layers it meets. The layers are the engine's, the ones the plugins that are on add and the
 * ones the project names in Project settings; a number that is not a single layer (an older project's) is shown as "custom" and left alone.
 */
export function CollisionLayerFields({ layer, mask, onLayer, onMask }: { layer: number; mask: number; onLayer(v: number): void; onMask(v: number): void }) {
  const layers = layerList();
  const known = layers.some((l) => 1 << l.bit === layer);
  const options = [...layers.map((l) => ({ value: 1 << l.bit, label: l.label })), ...(known ? [] : [{ value: layer, label: `Custom (${layer})` }])];
  return (
    <>
      <SelectField<number> label="Belongs to the layer" testId="insp-layer" value={layer} options={options} onChange={onLayer} />
      <details>
        <summary>Meets these layers</summary>
        {layers.map((l) => (
          <CheckField key={l.name} label={l.label} testId={`insp-meets-${l.name}`} value={(mask & (1 << l.bit)) !== 0} onChange={(on) => onMask(on ? mask | (1 << l.bit) : mask & ~(1 << l.bit))} />
        ))}
      </details>
    </>
  );
}
