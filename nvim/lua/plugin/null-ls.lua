return function()
    local nls = require('null-ls')

    local sources = {
        nls.builtins.formatting.prettier.with({
            filetypes = {
                'javascript', 'typescript', 'javascriptreact',
                'typescriptreact', 'json', 'markdown', 'graphql'
            },
            prefer_local = "node_modules/.bin"
        }),
        nls.builtins.formatting.rubocop.with({command = "bundle exec rubocop"}),
        nls.builtins.formatting.rustfmt, nls.builtins.formatting.lua_format
    }

    local format_group = vim.api.nvim_create_augroup('Format', {clear = true})

    vim.api.nvim_create_autocmd('BufWritePre', {
        pattern = {'*.js', '*.mjs', '*.ts', '*.jsx', '*.tsx', '*.rs', '*.lua'},
        callback = function() vim.lsp.buf.format({}, 5000) end,
        group = format_group
    })

    nls.setup({
        sources = sources,
        on_attach = function(client)
            if client.server_capabilities.documentFormatting then
                vim.api
                    .nvim_exec_autocmds('BufWritePre', {group = format_group})
            end
        end
    })

    vim.api.nvim_set_keymap('n', '<leader>f',
                            '<cmd>lua vim.lsp.buf.format()<cr>',
                            {noremap = true})
end
