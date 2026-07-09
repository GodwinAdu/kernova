import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  integrations: [
    starlight({
      title: 'Kernova',
      description: 'The Intelligent Systems Runtime',
      social: {
        github: 'https://github.com/nexus-runtime/nexus',
      },
      customCss: ['./src/styles/custom.css'],
      sidebar: [
        { label: 'Getting Started', autogenerate: { directory: 'getting-started' } },
        { label: 'Core Concepts', autogenerate: { directory: 'concepts' } },
        { label: 'Guides', autogenerate: { directory: 'guides' } },
        { label: 'API Reference', autogenerate: { directory: 'api' } },
        { label: 'Protocol', autogenerate: { directory: 'protocol' } },
      ],
    }),
  ],
});
