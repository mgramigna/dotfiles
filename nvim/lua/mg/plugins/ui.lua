return {
	"nvim-tree/nvim-web-devicons",
	{
		"stevearc/dressing.nvim",
		opts = {},
	},
	{
		'akinsho/bufferline.nvim',
		version = "*",
		dependencies = 'nvim-tree/nvim-web-devicons',
		event = "VeryLazy",
		config = function()
			require("bufferline").setup({ options = { diagnostics = "nvim_lsp", } })

			vim.keymap.set("n", "<leader>bn", "<cmd>BufferLineCycleNext<cr>")
			vim.keymap.set("n", "<leader>bp", "<cmd>BufferLineCyclePrev<cr>")
		end
	},
	{
		"nvim-lualine/lualine.nvim",
		event = "VeryLazy",
		config = function()
			require("lualine").setup({
				options = { theme = "catppuccin" },
				sections = {
					lualine_a = { "mode" },
					lualine_b = { "branch", "diff", "diagnostics" },
					lualine_c = { { "filename", path = 1 } },
					lualine_x = {},
					lualine_y = { "filetype" },
					lualine_z = {},
				},
			})
		end,
	},
	{
		{
			"stevearc/oil.nvim",
			dependencies = { "nvim-tree/nvim-web-devicons" },
			config = function()
				require("oil").setup()

				vim.keymap.set("n", "-", vim.cmd.Oil)
				vim.keymap.set("n", "<leader>of", "<CMD>Oil --float<CR>")
			end,
		},
	},
	{
		"folke/zen-mode.nvim",
		cmd = "ZenMode",
		config = function()
			require("zen-mode").setup({
				window = {
					width = 0.66,
				},
			})
		end,
	},
	{
		"stevearc/quicker.nvim",
		event = "FileType qf",
		config = function()
			require("quicker").setup({})
			vim.keymap.set("n", "<leader>q", function()
				require("quicker").toggle()
			end, {
				desc = "Toggle quickfix",
			})
			vim.keymap.set("n", "<leader>l", function()
				require("quicker").toggle({ loclist = true })
			end, {
				desc = "Toggle loclist",
			})
		end,
	},
}
