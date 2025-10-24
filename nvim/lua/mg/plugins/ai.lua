return {
	{
		"zbirenbaum/copilot.lua",
		cmd = "Copilot",
		event = "InsertEnter",
		config = function()
			require("copilot").setup({
				suggestion = {
					enabled = true,
					auto_trigger = true,
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
		end,
	},
	{
		"olimorris/codecompanion.nvim",
		dependencies = {
			"nvim-lua/plenary.nvim",
			"nvim-treesitter/nvim-treesitter",
			"j-hui/fidget.nvim",
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
				prompt_library = {
					["Summarize git diff"] = {
						strategy = "chat",
						description = "Summarize the current git diff",
						opts = {
							index = 10,
							is_default = true,
							is_slash_cmd = true,
							short_name = "diff",
							auto_submit = true,
						},
						prompts = {
							{
								role = "user",
								content = function()
									return string.format(
										[[Take a look at the following git diff and summarize the changes made. Break it down by each file into a bulleted list.

```diff
%s
```
]],
										vim.fn.system("git diff --no-ext-diff --cached")
									)
								end,
								opts = {
									contains_code = true,
								},
							},
						},
					},
				},
			})
			require("mg.config.codecompanion.fidget-spinner"):init()

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
