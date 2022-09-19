return function()
	local actions = require("telescope.actions")
	require("telescope").setup({
		defaults = {
			mappings = { n = { ["q"] = actions.close } },
			file_ignore_patterns = { "^.git/" },
		},
		pickers = {
			find_files = { theme = "ivy" },
			live_grep = { theme = "ivy" },
			grep_string = { theme = "ivy" },
			buffers = { theme = "ivy" },
			treesitter = { theme = "dropdown" },
			spell_suggest = { theme = "cursor" },
		},
		extensions = {
			fzf = {
				fuzzy = true,
				override_generic_sorter = true,
				override_file_sorter = true,
				case_mode = "smart_case",
			},
		},
	})

	vim.api.nvim_set_keymap(
		"n",
		"<C-t>",
		":lua require'telescope.builtin'.find_files({ hidden = true })<cr>",
		{ noremap = true, silent = true }
	)
	vim.api.nvim_set_keymap(
		"n",
		"<C-s>",
		":lua require'telescope.builtin'.live_grep()<cr>",
		{ noremap = true, silent = true }
	)
	vim.api.nvim_set_keymap(
		"n",
		"<C-b>",
		":lua require'telescope.builtin'.buffers()<cr>",
		{ noremap = true, silent = true }
	)
	vim.api.nvim_set_keymap(
		"n",
		"<leader>t",
		":lua require'telescope.builtin'.treesitter()<cr>",
		{ noremap = true, silent = true }
	)
	vim.api.nvim_set_keymap(
		"n",
		"<leader>s",
		":lua require'telescope.builtin'.grep_string()<cr>",
		{ noremap = true, silent = true }
	)
	vim.api.nvim_set_keymap(
		"n",
		"<leader>x",
		":lua require'telescope.builtin'.spell_suggest()<cr>",
		{ noremap = true, silent = true }
	)

	require("telescope").load_extension("fzf")
end
