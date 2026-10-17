import { studio, useStudio } from '../studio/store';
import { TextField } from './fields';

/** A text box for a sound or music name that suggests the files in Assets -> Sounds. */
export function SoundField({ label, value, onCommit, testId }: { label: string; value: string; onCommit(v: string): void; testId?: string }) {
  useStudio((s) => s.assetsVersion);
  return <TextField label={label} value={value} onCommit={onCommit} testId={testId} suggestions={studio.sounds.map((s) => s.name)} />;
}
