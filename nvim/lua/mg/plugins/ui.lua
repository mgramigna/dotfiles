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
					lualine_x = { "filetype" },
					lualine_c = { { "filename", path = 1 } },
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

				vim.keymap.set("n", "<leader>o", vim.cmd.Oil)
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
