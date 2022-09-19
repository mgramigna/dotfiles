return function()
	require("focus").setup({ cursorline = false })

	vim.api.nvim_set_keymap("n", "<leader>h", ":FocusSplitLeft<CR>", { silent = true })
	vim.api.nvim_set_keymap("n", "<leader>j", ":FocusSplitDown<CR>", { silent = true })
	vim.api.nvim_set_keymap("n", "<leader>k", ":FocusSplitUp<CR>", { silent = true })
	vim.api.nvim_set_keymap("n", "<leader>l", ":FocusSplitRight<CR>", { silent = true })
	vim.api.nvim_set_keymap("n", "<leader>n", ":FocusSplitNicely<CR>", { silent = true })
	vim.api.nvim_set_keymap("n", "<leader>fd", ":FocusDisable<CR>", { silent = true })
end
