return {
	"kyazdani42/nvim-web-devicons",
	{
		"nvim-lualine/lualine.nvim",
		event = "VeryLazy",
		config = function()
			require("lualine").setup({ options = { theme = "dracula" } })
		end,
	},
	{
		"nvim-tree/nvim-tree.lua",
		config = function()
			require("nvim-tree").setup({
				trash = {
					cmd = "trash",
				},
			})

			vim.keymap.set("n", "<c-n>", vim.cmd.NvimTreeToggle)
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
