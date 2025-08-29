module.exports = {
  semi: false,
  singleQuote: true,
  printWidth: 100,
  trailingComma: 'es5',
  bracketSpacing: true,
  vueIndentScriptAndStyle: true,
  plugins: ['@trivago/prettier-plugin-sort-imports', 'prettier-plugin-tailwindcss'],
  importOrder: ['^vue(.*)$', '^@?w', '^@/(.*)$', '^[./]'],
  importOrderSeparation: true,
  importOrderSortSpecifiers: true,
}
