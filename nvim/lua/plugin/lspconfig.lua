return function()
  local lsp_installer = require("nvim-lsp-installer")

	local on_attach = function(_, bufnr)
	  local function buf_set_keymap(...) vim.api.nvim_buf_set_keymap(bufnr, ...) end

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
    buf_set_keymap('n', 'K', '<cmd>lua vim.lsp.buf.hover()<CR>', noremap_silent_opts)
	  buf_set_keymap('n', '<C-k>', '<cmd>lua vim.lsp.buf.signature_help()<CR>', noremap_silent_opts)
	end

  local capabilites = require('cmp_nvim_lsp').update_capabilities(vim.lsp.protocol.make_client_capabilities())

  local config = {
    ["eslint"] = {
      on_attach = on_attach
    },
    ["tsserver"] = {
      capabilites = capabilites,
      on_attach = on_attach,
      filetypes = { "typescript", "typescriptreact", "typescript.tsx" }
    },
    ["tailwindcss"] = {
      capabilites = capabilites
    },
    ["solargraph"]= {
      capabilites = capabilites,
      on_attach = on_attach
    },
    ["sumneko_lua"]= {
      capabilites = capabilites,
      on_attach = on_attach
    }
  }

  lsp_installer.on_server_ready(function(server)
    local opts = config[server.name]


    if (opts == nil) then
      server:setup({})
    else
      server:setup(opts)
    end
    vim.cmd [[ do User LspAttachBuffers ]]
  end)
end
