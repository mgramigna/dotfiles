return function()
	local nvim_lsp = require('lspconfig')

	local on_attach = function(client, bufnr)
	  local function buf_set_keymap(...) vim.api.nvim_buf_set_keymap(bufnr, ...) end
	  local function buf_set_option(...) vim.api.nvim_buf_set_option(bufnr, ...) end

	  buf_set_option('omnifunc', 'v:lua.vim.lsp.omnifunc')

	  local noremap_silent_opts = { noremap=true, silent=true }

	  buf_set_keymap('n', 'gD', '<Cmd>lua vim.lsp.buf.declaration()<CR>', noremap_silent_opts)
	  buf_set_keymap('n', 'gd', '<Cmd>lua vim.lsp.buf.definition()<CR>', noremap_silent_opts)
	  buf_set_keymap('n', 'gi', '<cmd>lua vim.lsp.buf.implementation()<CR>', noremap_silent_opts)
	  buf_set_keymap('n', 'gt', '<cmd>lua vim.lsp.buf.type_definition()<CR>', noremap_silent_opts)
	  buf_set_keymap('n', '<leader>rn', '<cmd>lua vim.lsp.buf.rename()<CR>', noremap_silent_opts)
	  buf_set_keymap('n', '<leader>do', '<cmd>lua vim.lsp.buf.code_action()<CR>', noremap_silent_opts)
	  buf_set_keymap('n', 'gr', '<cmd>lua vim.lsp.buf.references()<CR>', noremap_silent_opts)
	  buf_set_keymap('n', '<leader>e', '<cmd>lua vim.lsp.diagnostic.show_line_diagnostics()<CR>', noremap_silent_opts)
	  buf_set_keymap('n', '[g', '<cmd>lua vim.lsp.diagnostic.goto_prev()<CR>', noremap_silent_opts)
	  buf_set_keymap('n', ']g', '<cmd>lua vim.lsp.diagnostic.goto_next()<CR>', noremap_silent_opts)
	end

	nvim_lsp.diagnosticls.setup {
	  on_attach = on_attach,
	  filetypes = { 'javascript', 'javascriptreact', 'json', 'typescript', 'typescriptreact', 'css', 'markdown' },
	  init_options = {
      linters = {
        eslint = {
          command = 'eslint_d',
          rootPatterns = { '.git' },
          debounce = 100,
          args = { '--stdin', '--stdin-filename', '%filepath', '--format', 'json' },
          sourceName = 'eslint_d',
          parseJson = {
            errorsRoot = '[0].messages',
            line = 'line',
            column = 'column',
            endLine = 'endLine',
            endColumn = 'endColumn',
            message = '[eslint] ${message} [${ruleId}]',
            security = 'severity'
          },
          securities = {
            [2] = 'error',
            [1] = 'warning'
          }
        },
      },
	    filetypes = {
	      javascript = 'eslint',
	      javascriptreact = 'eslint',
	      typescript = 'eslint',
	      typescriptreact = 'eslint',
	    },
	  }
	}

	nvim_lsp.tsserver.setup {
	  on_attach = on_attach,
	  filetypes = { "typescript", "typescriptreact", "typescript.tsx" }
	}

	nvim_lsp.solargraph.setup {
	  on_attach = on_attach,
	  filetypes = { "ruby" }
	}
end
