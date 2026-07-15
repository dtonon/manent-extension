import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: ({ browser }) => ({
    name: 'Manent',
    description: 'Save web content as Manent notes',
    permissions: ['storage', 'activeTab', 'scripting', 'contextMenus', 'tabs'],
    host_permissions: ['<all_urls>'],
    ...(browser === 'firefox' && {
      browser_specific_settings: {
        gecko: { id: 'manent-extension@dtonon.com', strict_min_version: '128.0' },
      },
    }),
  }),
});
