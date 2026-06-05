return {
	{
		"olimorris/codecompanion.nvim",
		dependencies = {
			"nvim-lua/plenary.nvim",
			"nvim-treesitter/nvim-treesitter",
			"ravitemer/codecompanion-history.nvim",
		},
		config = function()
			require("codecompanion").setup({
				adapters = {
					http = {
						copilot = function()
							return require("codecompanion.adapters").extend("copilot", {
								schema = {
									model = {
										default = "gpt-4.1",
									},
								},
							})
						end,
					},
				},
				display = {
					diff = {
						provider = "mini_diff",
					},
				},
				extensions = {
					history = {
						enabled = true,
					},
				},
			})

			vim.keymap.set(
				{ "n", "v" },
				"<leader>ca",
				"<cmd>CodeCompanionActions<cr>",
				{ noremap = true, silent = true }
			)
			vim.keymap.set(
				{ "n", "v" },
				"<leader>cc",
				"<cmd>CodeCompanionChat Toggle<cr>",
				{ noremap = true, silent = true }
			)
			vim.keymap.set("v", "ga", "<cmd>CodeCompanionChat add<cr>", { noremap = true, silent = true })
			vim.keymap.set("n", "<leader>ch", "<cmd>CodeCompanionHistory<cr>", { noremap = true, silent = true })

			vim.cmd([[cab cc CodeCompanion]])
		end,
	},
}
