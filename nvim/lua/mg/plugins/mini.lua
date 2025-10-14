return {
	{
		"nvim-mini/mini.pick",
		version = "*",
		dependencies = {
			{
				"nvim-mini/mini.extra",
				version = "*",
				opts = {},
			},
		},
		opts = {},
		init = function()
			vim.keymap.set("n", "<leader>ff", "<cmd>Pick files<CR>", { silent = true })
			vim.keymap.set("n", "<leader>fb", "<cmd>Pick buffers<CR>", { silent = true })
			vim.keymap.set("n", "<leader>fs", "<cmd>Pick grep pattern='<cword>'<CR>", { silent = true })
			vim.keymap.set("n", "<leader>fg", "<cmd>Pick grep_live<CR>", { silent = true })
			vim.keymap.set("n", "<leader>fh", "<cmd>Pick help<CR>", { silent = true })
			vim.keymap.set("n", "<leader>fd", "<cmd>Pick diagnostic<CR>", { silent = true })
			vim.keymap.set("n", "<leader>fz", "<cmd>Pick git_files<CR>", { silent = true })
			vim.keymap.set("n", "<leader>fr", "<cmd>Pick lsp scope='references'<CR>", { silent = true })
		end,
	},
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
