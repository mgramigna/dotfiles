return function()
  local lsp_installer = require("nvim-lsp-installer")

  vim.g.coq_settings = {
    auto_start = true,
    keymap = {
      jump_to_mark = '<c-g>',
      manual_complete = '<c-y>'
    }
  }

  local coq = require("coq")

  local on_attach = function(client, bufnr)
    local function buf_set_keymap(...) vim.api.nvim_buf_set_keymap(bufnr, ...) end

    local noremap_silent_opts = { noremap=true, silent=true }

    client.resolved_capabilities.document_formatting = false
    client.resolved_capabilities.document_range_formatting = false

    buf_set_keymap('n', 'gD', '<Cmd>lua vim.lsp.buf.declaration()<CR>', noremap_silent_opts)
    buf_set_keymap('n', 'gd', '<Cmd>lua vim.lsp.buf.definition()<CR>', noremap_silent_opts)
    buf_set_keymap('n', 'gi', '<cmd>lua vim.lsp.buf.implementation()<CR>', noremap_silent_opts)
    buf_set_keymap('n', 'gt', '<cmd>lua vim.lsp.buf.type_definition()<CR>', noremap_silent_opts)
    buf_set_keymap('n', '<leader>rn', '<cmd>lua vim.lsp.buf.rename()<CR>', noremap_silent_opts)
    buf_set_keymap('n', 'gr', '<cmd>lua vim.lsp.buf.references()<CR>', noremap_silent_opts)
    buf_set_keymap('n', '<leader>e', '<cmd>lua vim.diagnostic.open_float(0, { border = "single", scope="line" })<CR>', noremap_silent_opts)
    buf_set_keymap('n', ']g', '<cmd>lua vim.diagnostic.goto_next({ float = {border = "single"}})<CR>', noremap_silent_opts)
    buf_set_keymap('n', '[g', '<cmd>lua vim.diagnostic.goto_prev({ float = {border = "single"}})<CR>', noremap_silent_opts)
    buf_set_keymap('n', 'K', '<cmd>lua vim.lsp.buf.hover()<CR>', noremap_silent_opts)
  end

  local config = {
    ["eslint"] = {
      on_attach = on_attach
    },
    ["tsserver"] = {
      on_attach = on_attach,
      filetypes = { "typescript", "typescriptreact", "typescript.tsx" }
    },
    ["solargraph"]= {
      on_attach = on_attach
    },
    ["sumneko_lua"]= {
      on_attach = on_attach,
      settings = {
        Lua = {
          diagnostics = {
            globals = { 'vim' }
          }
        }
      }
    },
    ["jdtls"] = {
      on_attach = on_attach,
    },
    ["pyright"] = {
      on_attach = on_attach,
    }
  }

  lsp_installer.on_server_ready(function(server)
    local opts = config[server.name]

    if (opts == nil) then
      server:setup(coq.lsp_ensure_capabilities({}))
    else
      server:setup(coq.lsp_ensure_capabilities(opts))
    end
    vim.cmd [[ do User LspAttachBuffers ]]
  end)
end
