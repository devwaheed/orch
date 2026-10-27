// Design lint for React/TSX. Spread into the web package's eslint.config.mjs:
//   import design from '../../design/lint/eslint.design.mjs';
//   export default [...design, /* your other config */];
const hex = '/#[0-9a-fA-F]{3,8}\\b/';
const colorFn = '/\\b(rgba?|hsla?|oklch|oklab)\\(/';
// Tailwind arbitrary values for type, spacing, radius and fonts must use a token, e.g. p-[var(--space-4)] — better: p-4.
const arbitrary = '/(^|\\s|:)-?(p[xytrbl]?|m[xytrbl]?|gap(-[xy])?|space-[xy]|text|rounded(-[a-z]+)?|font|leading)-\\[(?!var\\(--)/';

export default [
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: `Literal[value=${hex}]`,
          message: 'Raw colour. Use a token: var(--name) from design/tokens/tokens.css.',
        },
        {
          selector: `TemplateElement[value.raw=${hex}]`,
          message: 'Raw colour. Use a token: var(--name) from design/tokens/tokens.css.',
        },
        {
          selector: `Literal[value=${arbitrary}]`,
          message: 'Tailwind arbitrary value. Use the token utility (p-4, text-sm, rounded-lg) from the generated theme.',
        },
        {
          selector: `TemplateElement[value.raw=${arbitrary}]`,
          message: 'Tailwind arbitrary value. Use the token utility (p-4, text-sm, rounded-lg) from the generated theme.',
        },
        {
          selector: `Literal[value=${colorFn}]`,
          message: 'Raw colour function. Use a token: var(--name) from design/tokens/tokens.css.',
        },
        {
          // Inline styles may only set CSS custom properties (e.g. a computed width via --w)
          selector: "JSXAttribute[name.name='style'] Property > Identifier.key",
          message: 'Inline style properties bypass the design lint. Use Tailwind token utilities; only --custom-properties are allowed inline.',
        },
        {
          // Icons come from the design set only
          selector: "JSXOpeningElement[name.name='svg']",
          message: 'Use <Icon name="…"> from design/icons. New icons are added to the design first.',
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['lucide-react', 'react-icons', 'react-icons/*', '@heroicons/*', '@radix-ui/react-icons', '@tabler/icons-react', '@phosphor-icons/*'], message: 'Use <Icon> from design/icons.' },
            { group: ['@mui/*', 'antd', 'antd/*', '@chakra-ui/*', '@mantine/*', 'bootstrap', 'react-bootstrap'], message: 'No UI kits: they bring their own look. Build from the design components.' },
            { group: ['styled-components', '@emotion/*'], message: 'Styling is Tailwind utilities themed from the tokens (ADR 0012).' },
          ],
        },
      ],
    },
  },
  {
    // The icon component itself is the one place <svg> is drawn
    files: ['src/design/icons/**', 'src/**/Icon.tsx'],
    rules: { 'no-restricted-syntax': 'off' },
  },
];
