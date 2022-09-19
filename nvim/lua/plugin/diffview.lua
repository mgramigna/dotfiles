return function()
	require("diffview").setup()

	vim.api.nvim_set_keymap("n", "<leader>df", ":DiffviewOpen<CR>", { silent = true })
end
