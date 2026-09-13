import { definePlugin } from 'nitro';

import { close } from '@canary/api/shutdown';

export default definePlugin((nitro) => {
  nitro.hooks.hook('close', close);
});
