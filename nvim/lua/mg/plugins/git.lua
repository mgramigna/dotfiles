return {
	{
		"sindrets/diffview.nvim",
		cmd = "DiffviewOpen",
		dependencies = {
			"nvim-lua/plenary.nvim",
		},
		config = function()
			require("diffview").setup()

			vim.keymap.set("n", "<leader>df", vim.cmd.DiffviewFocusFiles)
		end,
	},
	{
		"ruifm/gitlinker.nvim",
		opts = {},
	},
}
