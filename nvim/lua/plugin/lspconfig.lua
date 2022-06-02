return function()
    require("nvim-lsp-installer").setup {}
    local lspconfig = require('lspconfig')

    vim.g.coq_settings = {
        auto_start = true,
        keymap = {jump_to_mark = '<c-g>', manual_complete = '<c-y>'},
        clients = {lsp = {weight_adjust = 2}}
    }

    local coq = require("coq")

    local function filter(name)
        return
            name ~= nil and name ~= 'null-ls' and name ~= 'eslint' and name ~=
                'tailwindcss'
    end

    function _G.do_rename()
        vim.lsp.buf.rename(nil, {
            filter = function(clients)
                local names = vim.tbl_filter(filter, clients)

                return #names ~= 0
            end
        })
    end

    local on_attach = function(client, bufnr)
        local function buf_set_keymap(...)
            vim.api.nvim_buf_set_keymap(bufnr, ...)
        end

        local noremap_silent_opts = {noremap = true, silent = true}

        client.server_capabilities.documentFormatting = false
        client.server_capabilities.documentFormatting = false

        buf_set_keymap('n', 'gD', '<Cmd>lua vim.lsp.buf.declaration()<CR>',
                       noremap_silent_opts)
        buf_set_keymap('n', 'gd', '<Cmd>lua vim.lsp.buf.definition()<CR>',
                       noremap_silent_opts)
        buf_set_keymap('n', 'gi', '<cmd>lua vim.lsp.buf.implementation()<CR>',
                       noremap_silent_opts)
        buf_set_keymap('n', 'gt', '<cmd>lua vim.lsp.buf.type_definition()<CR>',
                       noremap_silent_opts)
        buf_set_keymap('n', '<leader>rn', '<cmd>lua do_rename()<CR>',
                       noremap_silent_opts)
        buf_set_keymap('n', 'gr', '<cmd>lua vim.lsp.buf.references()<CR>',
                       noremap_silent_opts)
        buf_set_keymap('n', '<leader>e',
                       '<cmd>lua vim.diagnostic.open_float(0, { border = "single", scope="line" })<CR>',
                       noremap_silent_opts)
        buf_set_keymap('n', ']g',
                       '<cmd>lua vim.diagnostic.goto_next({ float = {border = "single"}})<CR>',
                       noremap_silent_opts)
        buf_set_keymap('n', '[g',
                       '<cmd>lua vim.diagnostic.goto_prev({ float = {border = "single"}})<CR>',
                       noremap_silent_opts)
        buf_set_keymap('n', 'K', '<cmd>lua vim.lsp.buf.hover()<CR>',
                       noremap_silent_opts)
        buf_set_keymap('n', '<leader>do',
                       '<cmd>lua vim.lsp.buf.code_action()<CR>',
                       noremap_silent_opts)
    end

    local servers = {
        ["tailwindcss"] = {
            filetypes = {"javascriptreact", "typescriptreact"},
            on_attach = on_attach
        },
        ["eslint"] = {on_attach = on_attach},
        ["tsserver"] = {
            on_attach = on_attach,
            filetypes = {"typescript", "typescriptreact", "typescript.tsx"}
        },
        ["solargraph"] = {on_attach = on_attach},
        ["sumneko_lua"] = {
            on_attach = on_attach,
            settings = {Lua = {diagnostics = {globals = {'vim'}}}}
        },
        ["jdtls"] = {on_attach = on_attach},
        ["pyright"] = {on_attach = on_attach},
        ["rust_analyzer"] = {on_attach = on_attach},
        ["ansiblels"] = {on_attach = on_attach}
    }

    for name, opts in pairs(servers) do
        lspconfig[name].setup(coq.lsp_ensure_capabilities(opts))
    end
end
