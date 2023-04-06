return {
	"kyazdani42/nvim-web-devicons",
	{
		"nvim-lualine/lualine.nvim",
		event = "VeryLazy",
		config = function()
			require("lualine").setup({
				options = { theme = "dracula-nvim" },
				sections = {
					lualine_x = { "filetype" },
				},
			})
		end,
	},
	{
		"nvim-neo-tree/neo-tree.nvim",
		branch = "v2.x",
		dependencies = {
			"MunifTanjim/nui.nvim",
		},
		keys = { "<C-n>" },
		config = function()
			vim.keymap.set("n", "<C-n>", vim.cmd.NeoTreeShowToggle)
		end,
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
