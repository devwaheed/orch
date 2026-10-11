// Design lint for CSS. Every visual value must come from design/tokens/tokens.css.
// Add to the web package: npx stylelint "src/**/*.css"
const scale = (prefix) => new RegExp(`^(var\\(--${prefix}-[a-z0-9]+\\)|0|auto|inherit)( (var\\(--${prefix}-[a-z0-9]+\\)|0|auto))*$`);

export default {
  rules: {
    // Colours: tokens only
    'color-no-hex': true,
    'color-named': 'never',
    'function-disallowed-list': ['rgb', 'rgba', 'hsl', 'hsla', 'hwb', 'lab', 'lch', 'oklab', 'oklch'],

    // Type, spacing, radius, fonts: scale steps only
    'declaration-property-value-allowed-list': {
      'font-size': [/^var\(--text-[a-z0-9]+\)$/, 'inherit'],
      'font-family': [/^var\(--font-(sans|mono)\)$/, 'inherit'],
      'font-weight': [/^var\(--weight-[a-z]+\)$/, 'inherit'],
      '/^border(-[a-z-]+)?-radius$/': [/^var\(--radius-[a-z0-9]+\)$/, '0', '50%'],
      '/^(margin|padding)(-(top|right|bottom|left|inline|block)(-(start|end))?)?$/': [scale('space')],
      '/^(row-|column-)?gap$/': [scale('space')],
    },

    // No shadows or gradients beyond the tokens' overlay/shadow
    'declaration-property-value-disallowed-list': {
      'box-shadow': [/^(?!none$)(?!.*var\(--(shadow|accent|focus)\)).+/],
      '/^background(-image)?$/': [/gradient\(/],
    },
  },
  overrides: [
    {
      // The token file is the only place raw values may live
      files: ['**/tokens.css'],
      rules: {
        'color-no-hex': null,
        'function-disallowed-list': null,
        'declaration-property-value-allowed-list': null,
        'declaration-property-value-disallowed-list': null,
      },
    },
  ],
};
