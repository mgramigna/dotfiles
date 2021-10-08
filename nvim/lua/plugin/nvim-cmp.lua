return function()
  local cmp = require('cmp')
  local lspkind = require('lspkind')

  vim.o.completeopt = "menu,menuone,noselect"

  cmp.setup({
    mapping = {
      ['<C-d>'] = cmp.mapping.scroll_docs(-4),
      ['<C-f>'] = cmp.mapping.scroll_docs(4),
      ['<C-l>'] = cmp.mapping.complete(),
      ['<C-e>'] = cmp.mapping.close(),
      ['<CR>'] = cmp.mapping.confirm({ select = true }),
    },
    sources = {
      { name = 'nvim_lsp' },
      { name = 'buffer' }
    },
    formatting = {
      format = lspkind.cmp_format({ with_text = false, max_width = 50 })
    }
  })
end
