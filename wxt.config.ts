import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'Manent',
    description: 'Save web content as Manent notes',
    permissions: ['storage', 'activeTab', 'scripting', 'contextMenus', 'tabs'],
  },
});
