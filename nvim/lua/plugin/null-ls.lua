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

  vim.api.nvim_set_keymap('n', '<leader>f', '<cmd>lua vim.lsp.buf.formatting_sync()<cr>', { noremap = true })

  nls.setup({
    sources = sources,
    on_attach = function(client)
      if client.resolved_capabilities.document_formatting then
            vim.cmd([[
            augroup LspFormatting
                autocmd!
                autocmd BufWritePre *.js,*.ts,*.tsx,*.jsx,*.lua,*.rb lua vim.lsp.buf.formatting_sync()
            augroup END
            ]])
        end
    end
  })
end
