return {
	"nvim-tree/nvim-web-devicons",
	{
		"stevearc/dressing.nvim",
		opts = {},
	},
	{
		"nvim-lualine/lualine.nvim",
		event = "VeryLazy",
		config = function()
			require("lualine").setup({
				options = { theme = "catppuccin" },
				sections = {
					lualine_a = { "mode" },
					lualine_b = { "branch", "diff" },
					lualine_c = { { "filename", path = 1 } },
					lualine_x = { "diagnostics" },
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
}
