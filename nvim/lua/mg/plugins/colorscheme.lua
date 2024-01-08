return {
	{
		"catppuccin/nvim",
		name = "catppuccin",
		priority = 1000,
		lazy = false,
		config = function()
			require("catppuccin").setup({
				flavour = "macchiato",
				integrations = {
					cmp = true,
					gitsigns = true,
					treesitter = true,
					fidget = true,
					harpoon = true,
					mason = true,
					lsp_saga = true,
					neotree = true,
					telescope = {
						enabled = true,
					},
				},
			})
			vim.cmd.colorscheme("catppuccin")
		end,
	},
}
