return {
	{
		"echasnovski/mini.notify",
		version = "*",
		config = function()
			require("mini.notify").setup({})

			vim.notify = require("mini.notify").make_notify()
		end,
	},
	{
		"echasnovski/mini.pairs",
		event = "VeryLazy",
		opts = {},
	},
	{ "echasnovski/mini.ai", version = "*", opts = {} },
	{ "echasnovski/mini.surround", version = "*", opts = {} },
	{
		"echasnovski/mini.diff",
		version = "*",
		config = function()
			require("mini.diff").setup({
				view = {
					style = "sign",
				},
				mappings = {
					goto_prev = "[c",
					goto_next = "]c",
				},
			})

			vim.keymap.set("n", "<leader>go", function()
				require("mini.diff").toggle_overlay(0)
			end, { desc = "Toggle Diff View" })
		end,
	},
	{
		"echasnovski/mini-git",
		version = "*",
		main = "mini.git",
		config = function()
			require("mini.git").setup()

			vim.keymap.set("n", "<leader>gb", "<cmd>vert Git blame -- %<cr>", { desc = "Git blame current file" })
			vim.keymap.set(
				{ "n", "x" },
				"<leader>gs",
				"<cmd>lua MiniGit.show_at_cursor()<CR>",
				{ desc = "Show at cursor" }
			)
			vim.keymap.set("n", "<leader>gc", "<cmd>Git commit<cr>", { desc = "Git commit" })
		end,
	},
}
