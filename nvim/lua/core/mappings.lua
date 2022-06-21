-- Easy window switching
vim.api.nvim_set_keymap("n", "<C-k>", ":wincmd k<cr>", { silent = true })
vim.api.nvim_set_keymap("n", "<C-j>", ":wincmd j<cr>", { silent = true })
vim.api.nvim_set_keymap("n", "<C-h>", ":wincmd h<cr>", { silent = true })
vim.api.nvim_set_keymap("n", "<C-l>", ":wincmd l<cr>", { silent = true })

-- Delete all buffers except current
vim.api.nvim_set_keymap("n", "<leader>bd", ":%bd|e#<cr>", { noremap = true })

-- Run mdpf on current markdown file
vim.api.nvim_create_user_command("MDExport", "!mdpdf %", {})
