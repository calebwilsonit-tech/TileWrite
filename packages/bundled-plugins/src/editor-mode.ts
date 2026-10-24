import { host } from '@tilewright/plugin-sdk';

// Tools (the editor, the playbot, tests of them) install the editor parts of plugins as well as their game parts.
host.inEditor = true;
