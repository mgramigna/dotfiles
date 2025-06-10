return {
	{
		'echasnovski/mini-git',
		version = '*',
		main = 'mini.git',
		config = function()
			require('mini.git').setup()

			vim.keymap.set("n", "<leader>gb", "<cmd>vert Git blame -- %<cr>", { desc = "Git blame current file" })
			vim.keymap.set({ 'n', 'x' }, '<leader>gs', '<cmd>lua MiniGit.show_at_cursor()<CR>', { desc = 'Show at cursor' })
		end,
	},
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
		'ruifm/gitlinker.nvim',
		opts = {},
	}
}
