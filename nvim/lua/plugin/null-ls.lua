return function()
  local nls = require('null-ls')

  local sources = {
    nls.builtins.formatting.prettier.with({
      filetypes = { 'javascript', 'typescript', 'javascriptreact', 'typescriptreact', 'json', 'markdown', 'graphql' },
      prefer_local = "node_modules/.bin"
    }),
    nls.builtins.formatting.rubocop.with({
      command = "bundle exec rubocop"
    }),
    nls.builtins.diagnostics.eslint_d,
  }

  nls.setup({
    sources = sources,
    on_attach = function(client)
      if client.resolved_capabilities.document_formatting then
            vim.api.nvim_create_augroup('LspFormatting', { clear = true })
            vim.api.nvim_create_autocmd('BufWritePre',  {
              group = 'LspFormatting',
              pattern = { '*.js', '*.ts', '*.jsx', '*.tsx' },
              callback = function()
                vim.lsp.buf.formatting_sync()
              end
            })
        end
    end
  })

  vim.api.nvim_set_keymap('n', '<leader>f', '<cmd>lua vim.api.nvim_do_autocmd("BufWritePre", { group = "LspFormatting" })<cr>', { noremap = true })
end
