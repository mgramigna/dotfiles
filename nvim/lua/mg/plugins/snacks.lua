return {
	"folke/snacks.nvim",
	priority = 1000,
	lazy = false,
	---@type snacks.Config
	opts = {
		input = {},
		lazygit = {},
	},
	keys = {
		-- Top Pickers & Explorer
		{
			"<leader>lg",
			function()
				Snacks.lazygit()
			end,
			desc = "Toggle lazygit",
		},
	},
}
