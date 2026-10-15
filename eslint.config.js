// ESLint (flat config). The TypeScript sources are checked by `tsc` with strict, unused-code and
// fallthrough checks (see the lint script); ESLint's recommended rules then run over the compiled
// JavaScript and the build scripts. (typescript-eslint could not be installed in this environment.)
// @eslint/js is not installed here, so the core "recommended" rules are listed explicitly.
const recommended = Object.fromEntries([
  'constructor-super', 'for-direction', 'getter-return', 'no-async-promise-executor', 'no-case-declarations', 'no-class-assign', 'no-compare-neg-zero',
  'no-cond-assign', 'no-const-assign', 'no-constant-binary-expression', 'no-constant-condition', 'no-control-regex', 'no-debugger', 'no-delete-var',
  'no-dupe-args', 'no-dupe-class-members', 'no-dupe-else-if', 'no-dupe-keys', 'no-duplicate-case', 'no-empty', 'no-empty-character-class',
  'no-empty-pattern', 'no-empty-static-block', 'no-ex-assign', 'no-extra-boolean-cast', 'no-fallthrough', 'no-func-assign', 'no-global-assign',
  'no-import-assign', 'no-invalid-regexp', 'no-irregular-whitespace', 'no-loss-of-precision', 'no-misleading-character-class', 'no-new-native-nonconstructor',
  'no-nonoctal-decimal-escape', 'no-obj-calls', 'no-octal', 'no-prototype-builtins', 'no-redeclare', 'no-regex-spaces', 'no-self-assign',
  'no-setter-return', 'no-shadow-restricted-names', 'no-sparse-arrays', 'no-this-before-super', 'no-undef', 'no-unexpected-multiline',
  'no-unreachable', 'no-unsafe-finally', 'no-unsafe-negation', 'no-unsafe-optional-chaining', 'no-unused-labels', 'no-unused-private-class-members',
  'no-useless-backreference', 'no-useless-catch', 'no-useless-escape', 'no-with', 'require-yield', 'use-isnan', 'valid-typeof',
].map((r) => [r, 'error']));

const node = { process: 'readonly', console: 'readonly', Buffer: 'readonly', URL: 'readonly', URLSearchParams: 'readonly', fetch: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly', crypto: 'readonly', Response: 'readonly', Headers: 'readonly', AbortController: 'readonly', TextEncoder: 'readonly', TextDecoder: 'readonly', structuredClone: 'readonly' };
const browser = { window: 'readonly', document: 'readonly', location: 'readonly', history: 'readonly', localStorage: 'readonly', sessionStorage: 'readonly', navigator: 'readonly', HTMLElement: 'readonly', HTMLInputElement: 'readonly', HTMLFormElement: 'readonly', HTMLSelectElement: 'readonly', HTMLTextAreaElement: 'readonly', HTMLButtonElement: 'readonly', HTMLAnchorElement: 'readonly', SVGLineElement: 'readonly', MutationObserver: 'readonly', Element: 'readonly', Node: 'readonly', KeyboardEvent: 'readonly', Event: 'readonly', FormData: 'readonly', btoa: 'readonly', Intl: 'readonly' };

export default [
  { ignores: ['node_modules/**', 'dist/preview/**', 'storage/**', 'storage-test/**'] },
  { rules: recommended },
  {
    files: ['dist/src/**/*.js', 'dist/tests/**/*.js', 'scripts/**/*.mjs', 'eslint.config.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: node },
    rules: { 'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' }], eqeqeq: ['error', 'smart'], 'no-console': 'off' },
  },
  {
    files: ['dist/public/js/**/*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...browser, ...node } },
    rules: { 'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' }], eqeqeq: ['error', 'smart'] },
  },
];
