return {
	"nvim-telescope/telescope.nvim",
	tag = "0.1.0",
	dependencies = {
		"nvim-lua/plenary.nvim",
		{
			"nvim-telescope/telescope-fzf-native.nvim",
			build = "make",
		},
		"debugloop/telescope-undo.nvim",
	},
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

		vim.keymap.set("n", "<C-t>", ":lua require'telescope.builtin'.find_files()<cr>")
		vim.keymap.set("n", "<C-p>", ":lua require'telescope.builtin'.git_files()<cr>")
		vim.keymap.set("n", "<C-s>", ":lua require'telescope.builtin'.live_grep()<cr>")
		vim.keymap.set("n", "<C-b>", ":lua require'telescope.builtin'.buffers()<cr>")
		vim.keymap.set("n", "<leader>t", ":lua require'telescope.builtin'.treesitter()<cr>")
		vim.keymap.set("n", "<leader>s", ":lua require'telescope.builtin'.grep_string()<cr>")
		vim.keymap.set("n", "<leader>x", ":lua require'telescope.builtin'.spell_suggest()<cr>")

		telescope.load_extension("fzf")
		telescope.load_extension("undo")

		vim.keymap.set("n", "<leader>u", "<cmd>Telescope undo<cr>")
	end,
}
