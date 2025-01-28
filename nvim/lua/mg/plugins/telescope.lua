---@diagnostic disable: missing-fields
--- TODO: deprecate this when comfortable with newer binds
local telescope_keys = {
	find_files = "<C-t>",
	git_files = "<C-p>",
	live_grep = "<C-s>",
	buffers = "<C-b>",
	grep_string = "<leader>gs",
	spell_suggest = "<leader>x",
}

return {
	{
		"nvim-telescope/telescope.nvim",
		tag = "0.1.8",
		dependencies = {
			"nvim-lua/plenary.nvim",
			{
				"nvim-telescope/telescope-fzf-native.nvim",
				build = "make",
			},
		},
		config = function()
			local telescope = require("telescope")
			local builtin = require("telescope.builtin")
			local actions = require("telescope.actions")

			telescope.setup({
				defaults = {
					mappings = { n = { ["q"] = actions.close } },
				},
				pickers = {
					find_files = { theme = "ivy" },
					git_files = { theme = "ivy" },
					buffers = { theme = "ivy" },
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

			vim.keymap.set("n", telescope_keys.find_files, builtin.find_files, { silent = true })
			vim.keymap.set("n", "<leader>ff", builtin.find_files, { silent = true })
			vim.keymap.set("n", telescope_keys.git_files, builtin.git_files, { silent = true })
			vim.keymap.set("n", "<leader>fz", builtin.git_files, { silent = true })
			vim.keymap.set("n", telescope_keys.live_grep, builtin.live_grep, { silent = true })
			vim.keymap.set("n", "<leader>fb", builtin.buffers, { silent = true })
			vim.keymap.set("n", "<leader>fs", builtin.grep_string, { silent = true })
			vim.keymap.set("n", "<leader>fx", builtin.spell_suggest, { silent = true })
			vim.keymap.set("n", "<leader>fh", builtin.help_tags, { silent = true })
			vim.keymap.set("n", "<leader>fd", builtin.diagnostics, { silent = true })

			telescope.load_extension("fzf")

			require("mg.config.telescope").setup({})
		end,
	},
}
