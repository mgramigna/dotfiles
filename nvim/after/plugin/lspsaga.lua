local saga = require('lspsaga')
saga.init_lsp_saga()

vim.api.nvim_set_keymap('n', 'K', ':Lspsaga hover_doc<CR>', { noremap = true, silent = true })
vim.api.nvim_set_keymap('n', 'gh', ':Lspsaga lsp_finder<CR>', { noremap = true, silent = true })
vim.api.nvim_set_keymap('i', vim.api.nvim_replace_termcodes('<C-k>', true, true, true), '<CMD>Lspsaga signature_help<CR>', { noremap = true, silent = true })
