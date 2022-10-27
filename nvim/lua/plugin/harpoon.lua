return function()
	require("harpoon").setup()

	vim.api.nvim_set_keymap(
		"n",
		"<leader>zf",
		":lua require('harpoon.mark').add_file()<cr>",
		{ noremap = true, silent = true }
	)

	vim.api.nvim_set_keymap("n", "<leader>zl", ":Telescope harpoon marks<cr>", { noremap = true, silent = true })

	vim.api.nvim_set_keymap(
		"n",
		"<leader>zm",
		":lua require('harpoon.ui').toggle_quick_menu()<cr>",
		{ noremap = true, silent = true }
	)

	vim.api.nvim_set_keymap(
		"n",
		"<leader>m1",
		":lua require('harpoon.ui').nav_file(1)<cr>",
		{ noremap = true, silent = true }
	)
	vim.api.nvim_set_keymap(
		"n",
		"<leader>m2",
		":lua require('harpoon.ui').nav_file(2)<cr>",
		{ noremap = true, silent = true }
	)
	vim.api.nvim_set_keymap(
		"n",
		"<leader>m3",
		":lua require('harpoon.ui').nav_file(3)<cr>",
		{ noremap = true, silent = true }
	)
	vim.api.nvim_set_keymap(
		"n",
		"<leader>m4",
		":lua require('harpoon.ui').nav_file(4)<cr>",
		{ noremap = true, silent = true }
	)
end
