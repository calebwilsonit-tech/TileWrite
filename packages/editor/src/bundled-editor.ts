// The editor is a composition root: it makes the plugins that ship with Tilewright known to the plugin host, with their editor parts,
// and the example plugins that show people who write plugins what each kind of addition does. An exported game never imports this.
import '@tilewright/bundled-plugins/tooling';
import { host } from '@tilewright/plugin-sdk';
import { EXAMPLES } from '@tilewright/plugin-examples';

for (const e of EXAMPLES) host.register(e.plugin);
