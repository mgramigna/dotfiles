local telescope_keys = {
	find_files = "<C-t>",
	git_files = "<C-p>",
	live_grep = "<C-s>",
	live_grep_dir = "<leader>sg",
	buffers = "<C-b>",
	treesitter = "<leader>t",
	grep_string = "<leader>s",
	spell_suggest = "<leader>x",
	undo = "<leader>u",
}

local used_keys = {}

for _, v in pairs(telescope_keys) do
	table.insert(used_keys, v)
end

return {
	{
		"nvim-telescope/telescope.nvim",
		tag = "0.1.7",
		dependencies = {
			"nvim-lua/plenary.nvim",
			{
				"nvim-telescope/telescope-fzf-native.nvim",
				build = "make",
			},
			"debugloop/telescope-undo.nvim",
		},
		keys = used_keys,
		config = function()
			local telescope = require("telescope")

			local actions = require("telescope.actions")
			telescope.setup({
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
					undo = {
						use_delta = false,
					},
				},
			})

			vim.keymap.set(
				"n",
				telescope_keys.find_files,
				":lua require'telescope.builtin'.find_files()<cr>",
				{ silent = true }
			)
			vim.keymap.set(
				"n",
				telescope_keys.git_files,
				":lua require'telescope.builtin'.git_files()<cr>",
				{ silent = true }
			)
			vim.keymap.set(
				"n",
				telescope_keys.live_grep,
				":lua require'telescope.builtin'.live_grep()<cr>",
				{ silent = true }
			)
			vim.keymap.set("n", telescope_keys.live_grep_dir, ":Telescope live_grep search_dirs=")
			vim.keymap.set(
				"n",
				telescope_keys.buffers,
				":lua require'telescope.builtin'.buffers()<cr>",
				{ silent = true }
			)
			vim.keymap.set(
				"n",
				telescope_keys.treesitter,
				":lua require'telescope.builtin'.treesitter()<cr>",
				{ silent = true }
			)
			vim.keymap.set(
				"n",
				telescope_keys.grep_string,
				":lua require'telescope.builtin'.grep_string()<cr>",
				{ silent = true }
			)
			vim.keymap.set(
				"n",
				telescope_keys.spell_suggest,
				":lua require'telescope.builtin'.spell_suggest()<cr>",
				{ silent = true }
			)

			telescope.load_extension("fzf")
			telescope.load_extension("undo")

			vim.keymap.set("n", telescope_keys.undo, "<cmd>Telescope undo<cr>", { silent = true })
		end,
	},
}
