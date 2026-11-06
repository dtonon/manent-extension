import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: ({ browser }) => ({
    name: 'Manent',
    description: 'Save web content as Manent notes',
    permissions: ['storage', 'activeTab', 'scripting', 'contextMenus', 'tabs'],
    host_permissions: ['<all_urls>'],
    commands: {
      _execute_action: {
        suggested_key: { default: 'Alt+Shift+M' },
        description: 'Open Manent',
      },
      'save-link': {
        suggested_key: { default: 'Alt+Shift+S' },
        description: 'Save the page link to Manent',
      },
    },
    ...(browser === 'firefox' && {
      browser_specific_settings: {
        gecko: { id: 'manent-extension@dtonon.com', strict_min_version: '128.0' },
      },
    }),
  }),
});
