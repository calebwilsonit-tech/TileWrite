/** Release numbers of Tilewright ("0.1.0"): which of two is newer. */
export function compareReleases(a: string, b: string): number {
  const pa = a.split('.').map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** The sentence to show when a project needs a newer Tilewright than the one running, or null when this one is new enough (or the project says nothing). */
export function engineTooOld(project: { engine?: string | undefined }, running: string): string | null {
  if (!project.engine || compareReleases(running, project.engine) >= 0) return null;
  return `This project needs Tilewright ${project.engine} or newer, and this is ${running}. Install the newest Tilewright first: some of its menus, prompts and controls will not work here.`;
}
