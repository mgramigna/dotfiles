return {
	{
		"catppuccin/nvim",
		name = "catppuccin",
		priority = 1000,
		lazy = false,
		config = function()
			require("catppuccin").setup({
				float = {
					solid = false,
					transparent = true,
				},
				flavour = "macchiato",
				integrations = {
					indent_blankline = {
						enabled = true,
					},
					blink_cmp = {
						style = "bordered",
					},
					blink_pairs = true,
					treesitter = true,
					fidget = true,
					harpoon = true,
					mason = true,
					diffview = true,
					render_markdown = true,
					dadbod_ui = true,
				},
			})
			vim.cmd.colorscheme("catppuccin")
		end,
	},
}
