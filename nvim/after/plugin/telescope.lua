local actions = require("telescope.actions")
require("telescope").setup({
	defaults = {
		mappings = { n = { ["q"] = actions.close } },
	},
	pickers = {
		buffers = { theme = "dropdown" },
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

vim.keymap.set("n", "<C-t>", ":lua require'telescope.builtin'.find_files()<cr>")
vim.keymap.set("n", "<C-s>", ":lua require'telescope.builtin'.live_grep()<cr>")
vim.keymap.set("n", "<C-b>", ":lua require'telescope.builtin'.buffers()<cr>")
vim.keymap.set("n", "<leader>t", ":lua require'telescope.builtin'.treesitter()<cr>")
vim.keymap.set("n", "<leader>s", ":lua require'telescope.builtin'.grep_string()<cr>")
vim.keymap.set("n", "<leader>x", ":lua require'telescope.builtin'.spell_suggest()<cr>")

require("telescope").load_extension("fzf")
