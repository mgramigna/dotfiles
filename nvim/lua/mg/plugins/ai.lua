return {
	{
		"zbirenbaum/copilot.lua",
		cmd = "Copilot",
		event = "InsertEnter",
		config = function()
			require("copilot").setup({
				suggestion = {
					enabled = true,
					auto_trigger = false,
					trigger_on_accept = true,
					keymap = {
						accept = "<C-j>",
						accept_word = false,
						accept_line = false,
						next = "<C-l>",
						prev = "<C-s>",
					},
				},
			})
		end
	},
	{
		"olimorris/codecompanion.nvim",
		opts = {},
		dependencies = {
			"nvim-lua/plenary.nvim",
			"nvim-treesitter/nvim-treesitter",
		},
	},
}
