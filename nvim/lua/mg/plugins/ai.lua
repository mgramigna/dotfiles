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
		dependencies = {
			"nvim-lua/plenary.nvim",
			"nvim-treesitter/nvim-treesitter",
			"j-hui/fidget.nvim"
		},
		config = function()
			require("codecompanion").setup({})
			require("mg.config.codecompanion.fidget-spinner"):init()

			vim.keymap.set({ "n", "v" }, "<leader>ca", "<cmd>CodeCompanionActions<cr>", { noremap = true, silent = true })
			vim.keymap.set({ "n", "v" }, "<leader>cc", "<cmd>CodeCompanionChat Toggle<cr>", { noremap = true, silent = true })

			vim.cmd([[cab cc CodeCompanion]])
		end
	},
}
